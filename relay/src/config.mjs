import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function integer(name, fallback, minimum, maximum) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function tokenSha256(token) {
  return createHash('sha256').update(token).digest('hex');
}

export async function loadConfig() {
  const authFile = process.env.MAILBOX_AUTH_FILE;
  if (!authFile) throw new Error('MAILBOX_AUTH_FILE is required');
  const authDocument = JSON.parse(await readFile(resolve(authFile), 'utf8'));
  if (![1, 2].includes(authDocument.schemaVersion)) {
    throw new Error('MAILBOX_AUTH_FILE must use schemaVersion 1 or 2');
  }
  const mailboxes = new Map();
  for (const [mailboxId, value] of Object.entries(authDocument.mailboxes ?? {})) {
    if (
      typeof value?.tokenSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.tokenSha256) ||
      typeof value?.spaceId !== 'string' ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(value.spaceId)
    ) {
      throw new Error('MAILBOX_AUTH_FILE contains an invalid credential entry');
    }
    mailboxes.set(mailboxId, { tokenSha256: value.tokenSha256, spaceId: value.spaceId });
  }
  const spaces = new Map();
  for (const [spaceId, value] of Object.entries(authDocument.spaces ?? {})) {
    if (
      !/^[A-Za-z0-9_-]{16,128}$/.test(spaceId) ||
      typeof value?.tokenSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.tokenSha256)
    ) {
      throw new Error('MAILBOX_AUTH_FILE contains an invalid space credential entry');
    }
    spaces.set(spaceId, { tokenSha256: value.tokenSha256, spaceId });
  }
  if (mailboxes.size === 0 && spaces.size === 0) {
    throw new Error('MAILBOX_AUTH_FILE contains no credentials');
  }
  const credentials = { mailboxes, spaces };

  return {
    host: process.env.HOST ?? '0.0.0.0',
    port: integer('PORT', 8787, 1, 65_535),
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    credentials,
    maxPayloadBytes: integer('MAX_PAYLOAD_BYTES', 10 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxMailboxBytes: integer('MAX_MAILBOX_BYTES', 50 * 1024 * 1024, 1024, 4 * 1024 * 1024 * 1024),
    maxMessagesPerMailbox: integer('MAX_MESSAGES_PER_MAILBOX', 100, 1, 10_000),
    minTtlSeconds: integer('MIN_TTL_SECONDS', 30, 5, 3600),
    maxTtlSeconds: integer('MAX_TTL_SECONDS', 86_400, 30, 604_800),
    leaseSeconds: integer('LEASE_SECONDS', 30, 5, 300),
    ratePerMinute: integer('RATE_PER_MINUTE', 120, 1, 100_000),
    rateBurst: integer('RATE_BURST', 30, 1, 10_000),
    shutdownGraceMs: integer('SHUTDOWN_GRACE_MS', 10_000, 100, 120_000),
  };
}
