import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MailboxError, MailboxStore } from '../src/mailbox-store.mjs';

const mailboxId = 'device_mailbox_0001';

async function fixture(overrides = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'uniclipboard-mailbox-'));
  const clock = { now: 1_800_000_000_000 };
  const store = new MailboxStore({
    dataDir,
    minTtlSeconds: 5,
    maxTtlSeconds: 3600,
    now: () => clock.now,
    ...overrides,
  });
  await store.initialize();
  return {
    store,
    clock,
    cleanup: () => rm(dataDir, { recursive: true, force: true }),
  };
}

test('stores opaque ciphertext, leases once, and deletes only after acknowledgement', async (context) => {
  const { store, cleanup } = await fixture();
  context.after(cleanup);
  const ciphertext = Buffer.from('UCMB1:not-plaintext-in-a-real-client');

  const inserted = await store.put({
    mailboxId,
    eventId: 'event_00000001',
    ciphertext,
    ttlSeconds: 60,
  });
  assert.equal(inserted.duplicate, false);

  const duplicate = await store.put({
    mailboxId,
    eventId: 'event_00000001',
    ciphertext,
    ttlSeconds: 60,
  });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(await store.mailboxStats(mailboxId), {
    messages: 1,
    ciphertextBytes: ciphertext.length,
  });

  const leased = await store.leaseNext(mailboxId);
  assert.deepEqual(leased.ciphertext, ciphertext);
  assert.equal(await store.leaseNext(mailboxId), null);
  assert.equal(await store.acknowledge(mailboxId, leased.receipt), true);
  assert.equal(await store.acknowledge(mailboxId, leased.receipt), false);
  assert.deepEqual(await store.mailboxStats(mailboxId), { messages: 0, ciphertextBytes: 0 });
});

test('expired ciphertext is pruned and never delivered', async (context) => {
  const { store, clock, cleanup } = await fixture();
  context.after(cleanup);
  await store.put({
    mailboxId,
    eventId: 'event_00000002',
    ciphertext: Buffer.from('opaque'),
    ttlSeconds: 5,
  });
  clock.now += 5001;
  assert.equal(await store.leaseNext(mailboxId), null);
  assert.deepEqual(await store.mailboxStats(mailboxId), { messages: 0, ciphertextBytes: 0 });
});

test('lease becomes available after timeout without acknowledgement', async (context) => {
  const { store, clock, cleanup } = await fixture({ leaseSeconds: 10 });
  context.after(cleanup);
  await store.put({
    mailboxId,
    eventId: 'event_00000003',
    ciphertext: Buffer.from('opaque'),
    ttlSeconds: 60,
  });
  const first = await store.leaseNext(mailboxId);
  assert.ok(first);
  clock.now += 10_001;
  const second = await store.leaseNext(mailboxId);
  assert.ok(second);
  assert.notEqual(first.receipt, second.receipt);
});

test('enforces per-message and per-mailbox quotas', async (context) => {
  const { store, cleanup } = await fixture({
    maxPayloadBytes: 8,
    maxMailboxBytes: 10,
    maxMessagesPerMailbox: 2,
  });
  context.after(cleanup);
  await store.put({
    mailboxId,
    eventId: 'event_00000004',
    ciphertext: Buffer.alloc(6),
    ttlSeconds: 60,
  });
  await assert.rejects(
    store.put({
      mailboxId,
      eventId: 'event_00000005',
      ciphertext: Buffer.alloc(5),
      ttlSeconds: 60,
    }),
    (error) => error instanceof MailboxError && error.code === 'quota_exceeded',
  );
  await assert.rejects(
    store.put({
      mailboxId,
      eventId: 'event_00000006',
      ciphertext: Buffer.alloc(9),
      ttlSeconds: 60,
    }),
    (error) => error instanceof MailboxError && error.code === 'payload_too_large',
  );
});

