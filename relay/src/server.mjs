import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { MailboxError } from './mailbox-store.mjs';
import { PresenceRegistry } from './presence-registry.mjs';
import { TokenBucketLimiter } from './rate-limiter.mjs';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const SECURITY_HEADERS = {
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function constantTimeHexEqual(left, rightHex) {
  if (typeof left !== 'string' || !/^[a-f0-9]{64}$/.test(rightHex)) return false;
  const leftDigest = digest(left);
  const right = Buffer.from(rightHex, 'hex');
  return leftDigest.length === right.length && timingSafeEqual(leftDigest, right);
}

async function readBody(request, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new MailboxError('payload_too_large', 'request body exceeds limit');
      request.destroy();
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseBearer(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  return token.length >= 16 && token.length <= 512 ? token : null;
}

function routeFor(method, pathname) {
  if (method === 'GET' && pathname === '/healthz') return { name: 'health' };
  if (method === 'GET' && pathname === '/readyz') return { name: 'ready' };
  if (method === 'GET' && pathname === '/metrics') return { name: 'metrics' };

  let match = pathname.match(/^\/v1\/mailboxes\/([A-Za-z0-9_-]{16,128})\/events$/);
  if (method === 'POST' && match) return { name: 'mailbox_put', mailboxId: match[1] };
  match = pathname.match(/^\/v1\/mailboxes\/([A-Za-z0-9_-]{16,128})\/events\/next$/);
  if (method === 'GET' && match) return { name: 'mailbox_next', mailboxId: match[1] };
  match = pathname.match(
    /^\/v1\/mailboxes\/([A-Za-z0-9_-]{16,128})\/events\/receipts\/([A-Za-z0-9-]{16,128})$/,
  );
  if (method === 'DELETE' && match) {
    return { name: 'mailbox_ack', mailboxId: match[1], receipt: match[2] };
  }
  match = pathname.match(/^\/v1\/presence\/([A-Za-z0-9_-]{16,128})$/);
  if (method === 'PUT' && match) return { name: 'presence_put', mailboxId: match[1] };
  if (method === 'GET' && pathname === '/v1/presence') return { name: 'presence_list' };
  return { name: 'not_found' };
}

function responseJson(response, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    ...JSON_HEADERS,
    'content-length': body.length,
    ...extraHeaders,
  });
  response.end(body);
  return body.length;
}

function responseEmpty(response, status, extraHeaders = {}) {
  response.writeHead(status, { ...SECURITY_HEADERS, ...extraHeaders });
  response.end();
  return 0;
}

function authenticate(request, mailboxId, credentials) {
  const token = parseBearer(request);
  if (!token) return null;
  const direct =
    credentials instanceof Map ? credentials.get(mailboxId) : credentials.mailboxes?.get(mailboxId);
  const candidates = direct
    ? [direct]
    : credentials instanceof Map
      ? []
      : [...(credentials.spaces?.values() ?? [])];
  const credential = candidates.find((candidate) =>
    constantTimeHexEqual(token, candidate.tokenSha256),
  );
  if (!credential) return null;
  return {
    mailboxId,
    spaceId: credential.spaceId,
    fingerprint: createHash('sha256').update(token).digest('hex').slice(0, 16),
  };
}

export function createRelayServer({
  store,
  credentials,
  maxPayloadBytes,
  ratePerMinute = 120,
  rateBurst = 30,
  now = () => Date.now(),
  logger = (record) => process.stdout.write(`${JSON.stringify(record)}\n`),
}) {
  const metrics = {
    requests: new Map(),
    uploadedBytes: 0,
    downloadedBytes: 0,
    acknowledged: 0,
    expiredOrMissingAcks: 0,
    authFailures: 0,
    rateLimited: 0,
  };
  const limiter = new TokenBucketLimiter({ ratePerMinute, burst: rateBurst, now });
  const presence = new PresenceRegistry({ now });

  const server = createHttpServer(async (request, response) => {
    const startedAt = now();
    const requestId = randomUUID();
    let route = { name: 'invalid_url' };
    let status = 500;
    let responseBytes = 0;
    try {
      const url = new URL(request.url ?? '/', 'http://relay.invalid');
      route = routeFor(request.method ?? 'GET', url.pathname);

      if (route.name === 'health' || route.name === 'ready') {
        status = 200;
        responseBytes = responseJson(response, status, { status: 'ok' });
        return;
      }
      if (route.name === 'metrics') {
        const storage = await store.globalStats();
        const lines = [
          '# TYPE uniclipboard_mailbox_requests_total counter',
          ...[...metrics.requests.entries()].map(
            ([key, count]) => `uniclipboard_mailbox_requests_total{route="${key}"} ${count}`,
          ),
          '# TYPE uniclipboard_mailbox_ciphertext_bytes gauge',
          `uniclipboard_mailbox_ciphertext_bytes ${storage.ciphertextBytes}`,
          '# TYPE uniclipboard_mailbox_messages gauge',
          `uniclipboard_mailbox_messages ${storage.messages}`,
          '# TYPE uniclipboard_mailbox_uploaded_bytes_total counter',
          `uniclipboard_mailbox_uploaded_bytes_total ${metrics.uploadedBytes}`,
          '# TYPE uniclipboard_mailbox_downloaded_bytes_total counter',
          `uniclipboard_mailbox_downloaded_bytes_total ${metrics.downloadedBytes}`,
          '# TYPE uniclipboard_mailbox_auth_failures_total counter',
          `uniclipboard_mailbox_auth_failures_total ${metrics.authFailures}`,
          '# TYPE uniclipboard_mailbox_rate_limited_total counter',
          `uniclipboard_mailbox_rate_limited_total ${metrics.rateLimited}`,
        ];
        const body = Buffer.from(`${lines.join('\n')}\n`);
        status = 200;
        response.writeHead(status, {
          ...SECURITY_HEADERS,
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'content-length': body.length,
        });
        response.end(body);
        responseBytes = body.length;
        return;
      }

      let auth;
      if (route.name === 'presence_list') {
        const callerMailboxId = request.headers['x-uniclipboard-mailbox-id'];
        auth =
          typeof callerMailboxId === 'string'
            ? authenticate(request, callerMailboxId, credentials)
            : null;
      } else if (route.mailboxId) {
        auth = authenticate(request, route.mailboxId, credentials);
      }
      if (!auth) {
        metrics.authFailures += 1;
        status = 401;
        responseBytes = responseJson(response, status, { error: 'unauthorized' });
        return;
      }

      const rate = limiter.consume(`${auth.fingerprint}:${route.name}`);
      if (!rate.allowed) {
        metrics.rateLimited += 1;
        status = 429;
        responseBytes = responseJson(
          response,
          status,
          { error: 'rate_limited' },
          { 'retry-after': String(Math.max(1, Math.ceil(rate.retryAfterMs / 1000))) },
        );
        return;
      }

      if (route.name === 'mailbox_put') {
        if (request.headers['content-type'] !== 'application/octet-stream') {
          status = 415;
          responseBytes = responseJson(response, status, { error: 'ciphertext_required' });
          return;
        }
        const eventId = request.headers['x-uniclipboard-event-id'];
        const ttlSeconds = Number(request.headers['x-uniclipboard-ttl-seconds']);
        const ciphertext = await readBody(request, maxPayloadBytes);
        const result = await store.put({
          mailboxId: route.mailboxId,
          eventId,
          ttlSeconds,
          ciphertext,
        });
        metrics.uploadedBytes += result.duplicate ? 0 : ciphertext.length;
        status = result.duplicate ? 200 : 201;
        responseBytes = responseJson(response, status, {
          stored: !result.duplicate,
          duplicate: result.duplicate,
          expiresAt: result.expiresAt,
        });
        return;
      }

      if (route.name === 'mailbox_next') {
        const leased = await store.leaseNext(route.mailboxId);
        if (!leased) {
          status = 204;
          responseBytes = responseEmpty(response, status);
          return;
        }
        metrics.downloadedBytes += leased.ciphertext.length;
        status = 200;
        response.writeHead(status, {
          ...SECURITY_HEADERS,
          'content-type': 'application/octet-stream',
          'content-length': leased.ciphertext.length,
          'x-uniclipboard-receipt': leased.receipt,
          'x-uniclipboard-event-digest': leased.eventDigest,
          'x-uniclipboard-expires-at': String(leased.expiresAt),
        });
        response.end(leased.ciphertext);
        responseBytes = leased.ciphertext.length;
        return;
      }

      if (route.name === 'mailbox_ack') {
        const acknowledged = await store.acknowledge(route.mailboxId, route.receipt);
        if (acknowledged) {
          metrics.acknowledged += 1;
          status = 204;
          responseBytes = responseEmpty(response, status);
        } else {
          metrics.expiredOrMissingAcks += 1;
          status = 404;
          responseBytes = responseJson(response, status, { error: 'receipt_not_found' });
        }
        return;
      }

      if (route.name === 'presence_put') {
        const body = await readBody(request, 4096);
        let value;
        try {
          value = JSON.parse(body.toString('utf8'));
        } catch {
          status = 400;
          responseBytes = responseJson(response, status, { error: 'invalid_json' });
          return;
        }
        const entry = presence.update({
          mailboxId: auth.mailboxId,
          spaceId: auth.spaceId,
          state: value.state,
          ttlSeconds: value.ttlSeconds,
          capabilities: value.capabilities,
        });
        status = 200;
        responseBytes = responseJson(response, status, {
          state: entry.state,
          observedAt: entry.observedAt,
          expiresAt: entry.expiresAt,
        });
        return;
      }

      if (route.name === 'presence_list') {
        status = 200;
        responseBytes = responseJson(response, status, {
          devices: presence.list(auth.spaceId).map((entry) => ({
            mailboxId: entry.mailboxId,
            state: entry.state,
            capabilities: entry.capabilities,
            observedAt: entry.observedAt,
            expiresAt: entry.expiresAt,
          })),
        });
        return;
      }

      status = 404;
      responseBytes = responseJson(response, status, { error: 'not_found' });
    } catch (error) {
      if (error instanceof MailboxError || error instanceof TypeError) {
        const statusByCode = {
          payload_too_large: 413,
          quota_exceeded: 429,
          corrupt_payload: 500,
        };
        status = statusByCode[error.code] ?? 400;
        responseBytes = responseJson(response, status, { error: error.code ?? 'invalid_request' });
      } else {
        status = 500;
        responseBytes = responseJson(response, status, { error: 'internal_error' });
      }
    } finally {
      metrics.requests.set(route.name, (metrics.requests.get(route.name) ?? 0) + 1);
      logger({
        timestamp: new Date(now()).toISOString(),
        level: status >= 500 ? 'error' : 'info',
        requestId,
        method: request.method,
        route: route.name,
        status,
        responseBytes,
        durationMs: Math.max(0, now() - startedAt),
      });
    }
  });

  server.keepAliveTimeout = 10_000;
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  return server;
}
