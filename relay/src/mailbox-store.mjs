import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const MAILBOX_ID_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, path);
}

export class MailboxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MailboxError';
    this.code = code;
  }
}

export class MailboxStore {
  #locks = new Map();

  constructor({
    dataDir,
    maxPayloadBytes = 10 * 1024 * 1024,
    maxMailboxBytes = 50 * 1024 * 1024,
    maxMessagesPerMailbox = 100,
    minTtlSeconds = 30,
    maxTtlSeconds = 86_400,
    leaseSeconds = 30,
    now = () => Date.now(),
  }) {
    if (!dataDir) throw new TypeError('dataDir is required');
    this.dataDir = dataDir;
    this.mailboxesDir = join(dataDir, 'mailboxes');
    this.maxPayloadBytes = maxPayloadBytes;
    this.maxMailboxBytes = maxMailboxBytes;
    this.maxMessagesPerMailbox = maxMessagesPerMailbox;
    this.minTtlSeconds = minTtlSeconds;
    this.maxTtlSeconds = maxTtlSeconds;
    this.leaseSeconds = leaseSeconds;
    this.now = now;
  }

  async initialize() {
    await mkdir(this.mailboxesDir, { recursive: true, mode: 0o700 });
  }

  async put({ mailboxId, eventId, ciphertext, ttlSeconds }) {
    this.#validateMailboxId(mailboxId);
    this.#validateEventId(eventId);
    if (!Buffer.isBuffer(ciphertext)) throw new MailboxError('invalid_payload', 'ciphertext must be bytes');
    if (ciphertext.length === 0 || ciphertext.length > this.maxPayloadBytes) {
      throw new MailboxError('payload_too_large', 'ciphertext size is outside the allowed range');
    }
    const ttl = Number(ttlSeconds);
    if (!Number.isInteger(ttl) || ttl < this.minTtlSeconds || ttl > this.maxTtlSeconds) {
      throw new MailboxError('invalid_ttl', 'ttl is outside the allowed range');
    }

    return this.#withLock(mailboxId, async () => {
      const directory = await this.#mailboxDirectory(mailboxId);
      const entries = await this.#liveEntries(directory);
      const eventDigest = sha256(eventId);
      const duplicate = entries.find((entry) => entry.eventDigest === eventDigest);
      if (duplicate) {
        return { duplicate: true, expiresAt: duplicate.expiresAt, ciphertextBytes: duplicate.ciphertextBytes };
      }
      const currentBytes = entries.reduce((total, entry) => total + entry.ciphertextBytes, 0);
      if (
        entries.length >= this.maxMessagesPerMailbox ||
        currentBytes + ciphertext.length > this.maxMailboxBytes
      ) {
        throw new MailboxError('quota_exceeded', 'mailbox quota exceeded');
      }

      const messageKey = randomUUID();
      const createdAt = this.now();
      const metadata = {
        schemaVersion: 1,
        messageKey,
        eventDigest,
        createdAt,
        expiresAt: createdAt + ttl * 1000,
        ciphertextBytes: ciphertext.length,
        ciphertextSha256: sha256(ciphertext),
        leaseReceiptDigest: null,
        leaseUntil: 0,
      };
      await atomicWrite(join(directory, `${messageKey}.blob`), ciphertext);
      try {
        await atomicWrite(join(directory, `${messageKey}.json`), JSON.stringify(metadata));
      } catch (error) {
        await rm(join(directory, `${messageKey}.blob`), { force: true });
        throw error;
      }
      return { duplicate: false, expiresAt: metadata.expiresAt, ciphertextBytes: ciphertext.length };
    });
  }

  async leaseNext(mailboxId) {
    this.#validateMailboxId(mailboxId);
    return this.#withLock(mailboxId, async () => {
      const directory = await this.#mailboxDirectory(mailboxId);
      const entries = await this.#liveEntries(directory);
      const now = this.now();
      const next = entries
        .filter((entry) => entry.leaseUntil <= now)
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      if (!next) return null;

      const receipt = randomUUID();
      next.leaseReceiptDigest = sha256(receipt);
      next.leaseUntil = now + this.leaseSeconds * 1000;
      await atomicWrite(join(directory, `${next.messageKey}.json`), JSON.stringify(next));
      const ciphertext = await readFile(join(directory, `${next.messageKey}.blob`));
      if (sha256(ciphertext) !== next.ciphertextSha256) {
        await this.#removeEntry(directory, next);
        throw new MailboxError('corrupt_payload', 'stored ciphertext failed integrity verification');
      }
      return {
        receipt,
        eventDigest: next.eventDigest,
        expiresAt: next.expiresAt,
        ciphertext,
      };
    });
  }

  async acknowledge(mailboxId, receipt) {
    this.#validateMailboxId(mailboxId);
    if (typeof receipt !== 'string' || receipt.length < 16 || receipt.length > 128) {
      throw new MailboxError('invalid_receipt', 'invalid receipt');
    }
    return this.#withLock(mailboxId, async () => {
      const directory = await this.#mailboxDirectory(mailboxId);
      const entries = await this.#liveEntries(directory);
      const receiptDigest = sha256(receipt);
      const entry = entries.find((candidate) => candidate.leaseReceiptDigest === receiptDigest);
      if (!entry) return false;
      await this.#removeEntry(directory, entry);
      return true;
    });
  }

  async mailboxStats(mailboxId) {
    this.#validateMailboxId(mailboxId);
    return this.#withLock(mailboxId, async () => {
      const directory = await this.#mailboxDirectory(mailboxId);
      const entries = await this.#liveEntries(directory);
      return {
        messages: entries.length,
        ciphertextBytes: entries.reduce((total, entry) => total + entry.ciphertextBytes, 0),
      };
    });
  }

  async globalStats() {
    let directories = [];
    try {
      directories = await readdir(this.mailboxesDir, { withFileTypes: true });
    } catch {
      return { mailboxes: 0, messages: 0, ciphertextBytes: 0 };
    }
    let mailboxes = 0;
    let messages = 0;
    let ciphertextBytes = 0;
    for (const directoryEntry of directories) {
      if (!directoryEntry.isDirectory()) continue;
      const directory = join(this.mailboxesDir, directoryEntry.name);
      const entries = await this.#liveEntries(directory);
      if (entries.length > 0) mailboxes += 1;
      messages += entries.length;
      ciphertextBytes += entries.reduce((total, entry) => total + entry.ciphertextBytes, 0);
    }
    return { mailboxes, messages, ciphertextBytes };
  }

  async #mailboxDirectory(mailboxId) {
    const directory = join(this.mailboxesDir, sha256(mailboxId));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return directory;
  }

  async #liveEntries(directory) {
    let names = [];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const entries = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const metadataPath = join(directory, name);
      try {
        const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
        const blobPath = join(directory, `${metadata.messageKey}.blob`);
        const blobStat = await stat(blobPath);
        if (
          metadata.schemaVersion !== 1 ||
          !Number.isSafeInteger(metadata.expiresAt) ||
          blobStat.size !== metadata.ciphertextBytes
        ) {
          await this.#removeEntry(directory, metadata);
          continue;
        }
        if (metadata.expiresAt <= this.now()) {
          await this.#removeEntry(directory, metadata);
          continue;
        }
        entries.push(metadata);
      } catch {
        await rm(metadataPath, { force: true });
      }
    }
    return entries;
  }

  async #removeEntry(directory, entry) {
    if (entry?.messageKey) {
      await rm(join(directory, `${entry.messageKey}.blob`), { force: true });
      await rm(join(directory, `${entry.messageKey}.json`), { force: true });
    }
  }

  async #withLock(mailboxId, operation) {
    const previous = this.#locks.get(mailboxId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    this.#locks.set(mailboxId, current);
    try {
      return await current;
    } finally {
      if (this.#locks.get(mailboxId) === current) this.#locks.delete(mailboxId);
    }
  }

  #validateMailboxId(mailboxId) {
    if (typeof mailboxId !== 'string' || !MAILBOX_ID_PATTERN.test(mailboxId)) {
      throw new MailboxError('invalid_mailbox', 'invalid mailbox id');
    }
  }

  #validateEventId(eventId) {
    if (typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId)) {
      throw new MailboxError('invalid_event', 'invalid event id');
    }
  }
}

