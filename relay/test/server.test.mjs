import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { tokenSha256 } from '../src/config.mjs';
import { MailboxStore } from '../src/mailbox-store.mjs';
import { createRelayServer } from '../src/server.mjs';

const mailboxId = 'device_mailbox_0001';
const spaceId = 'space_identifier_0001';
const token = 'testing-token-with-sufficient-entropy';

async function fixture(context, overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'uniclipboard-server-'));
  const logs = [];
  const store = new MailboxStore({
    dataDir,
    minTtlSeconds: 5,
    maxTtlSeconds: 3600,
  });
  await store.initialize();
  const server = createRelayServer({
    store,
    credentials: new Map([[mailboxId, { tokenSha256: tokenSha256(token), spaceId }]]),
    maxPayloadBytes: 1024,
    logger: (record) => logs.push(record),
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  context.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { baseUrl, logs };
}

function authHeaders(extra = {}) {
  return { authorization: `Bearer ${token}`, ...extra };
}

test('HTTP mailbox upload, lease and acknowledgement roundtrip', async (context) => {
  const { baseUrl, logs } = await fixture(context);
  const ciphertext = Buffer.from('UCMB1:opaque-ciphertext');
  const upload = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events`, {
    method: 'POST',
    headers: authHeaders({
      'content-type': 'application/octet-stream',
      'x-uniclipboard-event-id': 'event_00000001',
      'x-uniclipboard-ttl-seconds': '60',
    }),
    body: ciphertext,
  });
  assert.equal(upload.status, 201);
  assert.equal((await upload.json()).stored, true);

  const download = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events/next`, {
    headers: authHeaders(),
  });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), ciphertext);
  const receipt = download.headers.get('x-uniclipboard-receipt');
  assert.ok(receipt);

  const acknowledge = await fetch(
    `${baseUrl}/v1/mailboxes/${mailboxId}/events/receipts/${receipt}`,
    { method: 'DELETE', headers: authHeaders() },
  );
  assert.equal(acknowledge.status, 204);
  const empty = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events/next`, {
    headers: authHeaders(),
  });
  assert.equal(empty.status, 204);

  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(token), false);
  assert.equal(serializedLogs.includes(mailboxId), false);
  assert.equal(serializedLogs.includes('opaque-ciphertext'), false);
});

test('rejects invalid credentials and exposes non-sensitive health and metrics', async (context) => {
  const { baseUrl } = await fixture(context);
  const unauthorized = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events/next`, {
    headers: { authorization: 'Bearer wrong-token-that-is-long-enough' },
  });
  assert.equal(unauthorized.status, 401);
  assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
  const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
  assert.match(metrics, /uniclipboard_mailbox_auth_failures_total 1/);
  assert.equal(metrics.includes(mailboxId), false);
});

test('presence returns only the authenticated space and disables iOS-style forwarding', async (context) => {
  const { baseUrl } = await fixture(context);
  const update = await fetch(`${baseUrl}/v1/presence/${mailboxId}`, {
    method: 'PUT',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      state: 'background-limited',
      ttlSeconds: 60,
      capabilities: { relay: true, forwarding: true, backgroundLimited: true },
    }),
  });
  assert.equal(update.status, 200);
  const list = await fetch(`${baseUrl}/v1/presence`, {
    headers: authHeaders({ 'x-uniclipboard-mailbox-id': mailboxId }),
  });
  assert.equal(list.status, 200);
  const body = await list.json();
  assert.equal(body.devices.length, 1);
  assert.equal(body.devices[0].capabilities.forwarding, false);
});

test('rate limiting is explicit and provides Retry-After', async (context) => {
  const { baseUrl } = await fixture(context, { ratePerMinute: 1, rateBurst: 1 });
  const first = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events/next`, {
    headers: authHeaders(),
  });
  assert.equal(first.status, 204);
  const second = await fetch(`${baseUrl}/v1/mailboxes/${mailboxId}/events/next`, {
    headers: authHeaders(),
  });
  assert.equal(second.status, 429);
  assert.ok(second.headers.get('retry-after'));
});

test('a space credential authenticates independently derived device mailboxes', async (context) => {
  const credentials = {
    mailboxes: new Map(),
    spaces: new Map([[spaceId, { tokenSha256: tokenSha256(token), spaceId }]]),
  };
  const { baseUrl } = await fixture(context, { credentials });
  const derivedMailbox = 'derived_device_mailbox_0002';
  const upload = await fetch(`${baseUrl}/v1/mailboxes/${derivedMailbox}/events`, {
    method: 'POST',
    headers: authHeaders({
      'content-type': 'application/octet-stream',
      'x-uniclipboard-event-id': 'event_space_0001',
      'x-uniclipboard-ttl-seconds': '60',
    }),
    body: Buffer.from('opaque'),
  });
  assert.equal(upload.status, 201);
  const leased = await fetch(`${baseUrl}/v1/mailboxes/${derivedMailbox}/events/next`, {
    headers: authHeaders(),
  });
  assert.equal(leased.status, 200);
});
