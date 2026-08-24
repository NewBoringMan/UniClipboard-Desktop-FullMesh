import assert from 'node:assert/strict';
import test from 'node:test';
import { PresenceRegistry } from '../src/presence-registry.mjs';
import { TokenBucketLimiter } from '../src/rate-limiter.mjs';

test('background-limited presence can never advertise forwarding', () => {
  const clock = { now: 1_800_000_000_000 };
  const presence = new PresenceRegistry({ now: () => clock.now });
  presence.update({
    mailboxId: 'device_mailbox_0001',
    spaceId: 'space_identifier_0001',
    state: 'background-limited',
    ttlSeconds: 60,
    capabilities: { direct: true, relay: true, forwarding: true, backgroundLimited: true },
  });
  const [entry] = presence.list('space_identifier_0001');
  assert.equal(entry.capabilities.forwarding, false);
  clock.now += 60_001;
  assert.deepEqual(presence.list('space_identifier_0001'), []);
});

test('token bucket limits bursts and replenishes over time', () => {
  const clock = { now: 1_800_000_000_000 };
  const limiter = new TokenBucketLimiter({
    ratePerMinute: 60,
    burst: 2,
    now: () => clock.now,
  });
  assert.equal(limiter.consume('client').allowed, true);
  assert.equal(limiter.consume('client').allowed, true);
  assert.equal(limiter.consume('client').allowed, false);
  clock.now += 1000;
  assert.equal(limiter.consume('client').allowed, true);
});

