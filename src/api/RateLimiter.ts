// ── RateLimiter — Sliding Window ─────────────────────────────────────────────
//
// Dış bağımlılık yok. Her key (IP adresi, userId vb.) için son N istek
// zaman damgalarını tutar; pencere dışı damgalar temizlenir.
//
// Kullanım:
//   const rl = new RateLimiter(100, 60_000);   // dakikada 100 istek
//   const { ok, remaining, retryAfterMs } = rl.allow('192.168.1.1');

export interface RateCheckResult {
  ok:           boolean;
  remaining:    number;
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, number[]>();
  private readonly timer:   ReturnType<typeof setInterval>;

  readonly limit:    number;
  readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit    = limit;
    this.windowMs = windowMs;
    this.timer    = setInterval(() => this.cleanup(), 60_000);
    this.timer.unref?.();
  }

  allow(key: string): RateCheckResult {
    const now    = Date.now();
    const cutoff = now - this.windowMs;
    const hits   = (this.windows.get(key) ?? []).filter(t => t > cutoff);

    if (hits.length >= this.limit) {
      return { ok: false, remaining: 0, retryAfterMs: hits[0] + this.windowMs - now };
    }

    hits.push(now);
    this.windows.set(key, hits);
    return { ok: true, remaining: this.limit - hits.length, retryAfterMs: 0 };
  }

  destroy(): void {
    clearInterval(this.timer);
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    for (const [key, hits] of this.windows) {
      if (hits.every(t => t <= cutoff)) this.windows.delete(key);
    }
  }
}
