import { PgClient, PgConfig, QueryResult } from './PgClient';

// ── PgPool — Bağlantı Havuzu ─────────────────────────────────────────────────
//
// Basit FIFO bağlantı havuzu.
// • Boşta beklleyen bağlantıları yeniden kullanır (idle pool)
// • Maksimum bağlantı sayısı aşılınca yeni istekler sıraya girer
// • withTransaction(): BEGIN → fn() → COMMIT / ROLLBACK garantisi

export class PgPool {
  private readonly idle:    PgClient[] = [];
  private readonly waiters: Array<(c: PgClient) => void> = [];
  private activeCount = 0;

  constructor(
    private readonly cfg:     PgConfig,
    private readonly maxSize: number = 10,
  ) {}

  // ── Bağlantı edinme ───────────────────────────────────────────────────────────

  async acquire(): Promise<PgClient> {
    if (this.idle.length > 0) {
      return this.idle.pop()!;
    }

    if (this.activeCount < this.maxSize) {
      this.activeCount++;
      try {
        const client = new PgClient();
        await client.connect(this.cfg);
        return client;
      } catch (err) {
        this.activeCount--;
        throw err;
      }
    }

    // Havuz dolu — bağlantı serbest kalana kadar bekle
    return new Promise<PgClient>(resolve => this.waiters.push(resolve));
  }

  // ── Bağlantıyı serbest bırak ─────────────────────────────────────────────────

  release(client: PgClient): void {
    if (this.waiters.length > 0) {
      this.waiters.shift()!(client);
    } else {
      this.idle.push(client);
    }
  }

  // ── Tekil sorgu (bağlantıyı otomatik yönetir) ────────────────────────────────

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    const client = await this.acquire();
    try {
      return await client.query(sql, params);
    } finally {
      this.release(client);
    }
  }

  // ── Transaction sarmalayıcı ───────────────────────────────────────────────────
  //
  // Hata durumunda otomatik ROLLBACK yapar.
  // SELECT ... FOR UPDATE ile kombinlendiğinde seri erişim garantisi sağlar.

  async withTransaction<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
    const client = await this.acquire();
    try {
      await client.begin();
      const result = await fn(client);
      await client.commit();
      return result;
    } catch (err) {
      try { await client.rollback(); } catch { /* rollback hatalarını yut */ }
      throw err;
    } finally {
      this.release(client);
    }
  }

  // ── Havuzu kapat ─────────────────────────────────────────────────────────────

  async end(): Promise<void> {
    const clients = [...this.idle];
    this.idle.length = 0;
    await Promise.allSettled(clients.map(c => c.end()));
  }

  // ── Havuz istatistikleri ──────────────────────────────────────────────────────

  get stats() {
    return {
      active: this.activeCount,
      idle:   this.idle.length,
      waiters: this.waiters.length,
    };
  }
}

// ── Yardımcı: DATABASE_URL ayrıştırıcı ───────────────────────────────────────
//
// Örnek: postgres://user:pass@localhost:5432/dbname

export function parseDatabaseUrl(url: string): PgConfig {
  const u = new URL(url);
  return {
    host:     u.hostname || '127.0.0.1',
    port:     u.port ? parseInt(u.port) : 5432,
    database: u.pathname.replace(/^\//, '') || 'postgres',
    user:     u.username || 'postgres',
    password: u.password || undefined,
  };
}
