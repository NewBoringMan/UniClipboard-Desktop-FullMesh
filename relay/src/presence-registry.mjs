const PRESENCE_STATES = new Set([
  'paired',
  'recently-reachable',
  'connected',
  'background-limited',
  'offline',
]);

export class PresenceRegistry {
  #entries = new Map();

  constructor({ now = () => Date.now(), maxTtlSeconds = 300 } = {}) {
    this.now = now;
    this.maxTtlSeconds = maxTtlSeconds;
  }

  update({ mailboxId, spaceId, state, ttlSeconds, capabilities = {} }) {
    if (!PRESENCE_STATES.has(state)) throw new TypeError('invalid presence state');
    const ttl = Math.max(5, Math.min(this.maxTtlSeconds, Number(ttlSeconds) || 60));
    const safeCapabilities = {
      direct: Boolean(capabilities.direct),
      quic: Boolean(capabilities.quic),
      relay: Boolean(capabilities.relay),
      forwarding: Boolean(capabilities.forwarding),
      backgroundLimited: Boolean(capabilities.backgroundLimited),
    };
    if (safeCapabilities.backgroundLimited) safeCapabilities.forwarding = false;
    const entry = {
      mailboxId,
      spaceId,
      state,
      capabilities: safeCapabilities,
      observedAt: this.now(),
      expiresAt: this.now() + ttl * 1000,
    };
    this.#entries.set(mailboxId, entry);
    return entry;
  }

  list(spaceId) {
    this.prune();
    return [...this.#entries.values()]
      .filter((entry) => entry.spaceId === spaceId)
      .sort((left, right) => left.mailboxId.localeCompare(right.mailboxId));
  }

  prune() {
    const now = this.now();
    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(key);
    }
  }
}

