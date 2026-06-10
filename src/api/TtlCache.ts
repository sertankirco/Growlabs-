// ── TtlCache — Basit TTL önbelleği ───────────────────────────────────────────
//
// Tek değer için hafif zamanlı önbellek.
// Leaderboard gibi pahalı sorguların sık tekrarını önler.
//
//   const cache = new TtlCache<Top10>(5_000); // 5sn TTL
//   const v = cache.get() ?? await computeExpensive();
//   cache.set(v);

export class TtlCache<T> {
  private value:     T | undefined;
  private expiresAt: number = 0;

  constructor(private readonly ttlMs: number) {}

  get(): T | undefined {
    return Date.now() < this.expiresAt ? this.value : undefined;
  }

  set(value: T): void {
    this.value     = value;
    this.expiresAt = Date.now() + this.ttlMs;
  }

  invalidate(): void {
    this.expiresAt = 0;
  }
}
