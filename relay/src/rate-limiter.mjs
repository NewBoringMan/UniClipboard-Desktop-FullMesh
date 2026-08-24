export class TokenBucketLimiter {
  #buckets = new Map();

  constructor({ ratePerMinute, burst, now = () => Date.now() }) {
    if (!Number.isFinite(ratePerMinute) || ratePerMinute <= 0) {
      throw new TypeError('ratePerMinute must be positive');
    }
    if (!Number.isInteger(burst) || burst < 1) throw new TypeError('burst must be a positive integer');
    this.ratePerMillisecond = ratePerMinute / 60_000;
    this.burst = burst;
    this.now = now;
  }

  consume(key, cost = 1) {
    const now = this.now();
    const previous = this.#buckets.get(key) ?? { tokens: this.burst, updatedAt: now };
    const elapsed = Math.max(0, now - previous.updatedAt);
    const tokens = Math.min(this.burst, previous.tokens + elapsed * this.ratePerMillisecond);
    if (tokens < cost) {
      this.#buckets.set(key, { tokens, updatedAt: now });
      const retryAfterMs = Math.ceil((cost - tokens) / this.ratePerMillisecond);
      return { allowed: false, retryAfterMs };
    }
    this.#buckets.set(key, { tokens: tokens - cost, updatedAt: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  sweep(maxIdleMs = 300_000) {
    const cutoff = this.now() - maxIdleMs;
    for (const [key, bucket] of this.#buckets) {
      if (bucket.updatedAt < cutoff) this.#buckets.delete(key);
    }
  }
}

