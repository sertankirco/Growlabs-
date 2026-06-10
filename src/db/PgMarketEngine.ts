import { PgPool } from './PgPool';
import { PlayerId } from '../wallet/types';
import { MarketSnapshot, PricePoint } from '../market/MarketEngine';

// ── Volatilite sabitleri (MarketEngine ile aynı) ─────────────────────────────
const MAX_CHANGE       = 0.20;
const PERF_WEIGHT      = 0.15;
const DEMAND_WEIGHT    = 0.04;
const MIN_PRICE        = 50;
const SCORE_WINDOW     = 5;
const TRANSACTION_WIN  = 30;

// ── PgMarketEngine ────────────────────────────────────────────────────────────
//
// MarketEngine'in PostgreSQL-backed versiyonu.
// Fiyat geçmişi, performans eventleri ve talep baskısı veritabanında saklanır.
// Volatilite hesabı TypeScript tarafında yapılır; sonuç DB'ye yazılır.

export class PgMarketEngine {
  constructor(private readonly pool: PgPool) {}

  // ── Oyuncu kayıt ──────────────────────────────────────────────────────────────

  async registerPlayer(playerId: PlayerId, basePrice: number): Promise<void> {
    // Players tablosu PgSquadManager veya dışarıdan dolduruluyor olabilir — upsert
    await this.pool.query(
      `INSERT INTO players (player_id, name, position, base_market_price)
       VALUES ($1, $1, 'FWD', $2)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, basePrice],
    );
    await this.pool.query(
      `INSERT INTO market_prices (player_id, current_price, total_buys, total_sells)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, basePrice],
    );
    await this.pool.query(
      `INSERT INTO price_history (player_id, price, reason) VALUES ($1, $2, 'INIT')`,
      [playerId, basePrice],
    );
  }

  // ── Oyuncu ve pozisyon bilgisiyle kayıt ──────────────────────────────────────

  async registerPlayerFull(
    playerId: PlayerId,
    name: string,
    position: string,
    basePrice: number,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO players (player_id, name, position, base_market_price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (player_id) DO UPDATE SET name = EXCLUDED.name`,
      [playerId, name, position, basePrice],
    );
    await this.pool.query(
      `INSERT INTO market_prices (player_id, current_price, total_buys, total_sells)
       VALUES ($1, $2, 0, 0)
       ON CONFLICT (player_id) DO NOTHING`,
      [playerId, basePrice],
    );
    await this.pool.query(
      `INSERT INTO price_history (player_id, price, reason) VALUES ($1, $2, 'INIT')`,
      [playerId, basePrice],
    );
  }

  // ── Fiyat sorgusu ────────────────────────────────────────────────────────────

  async getPrice(playerId: PlayerId): Promise<number> {
    const r = await this.pool.query(
      'SELECT current_price FROM market_prices WHERE player_id = $1',
      [playerId],
    );
    if (r.rows.length === 0) throw new Error(`Oyuncu piyasada kayıtlı değil: ${playerId}`);
    return parseInt(r.rows[0].current_price!, 10);
  }

  async getSnapshot(playerId: PlayerId): Promise<MarketSnapshot> {
    const pr = await this.pool.query(
      `SELECT mp.current_price, p.base_market_price, mp.total_buys, mp.total_sells
       FROM market_prices mp
       JOIN players p ON p.player_id = mp.player_id
       WHERE mp.player_id = $1`,
      [playerId],
    );
    if (pr.rows.length === 0) throw new Error(`Oyuncu piyasada kayıtlı değil: ${playerId}`);
    const row = pr.rows[0];

    const currentPrice = parseInt(row.current_price!, 10);
    const prev         = await this.price24hAgo(playerId, currentPrice);
    const delta        = prev > 0 ? ((currentPrice - prev) / prev) * 100 : 0;

    return {
      playerId,
      currentPrice,
      basePrice:  parseInt(row.base_market_price!, 10),
      change24h:  Math.round(delta * 100) / 100,
      trend:      delta > 1 ? 'UP' : delta < -1 ? 'DOWN' : 'STABLE',
      totalBuys:  parseInt(row.total_buys ?? '0', 10),
      totalSells: parseInt(row.total_sells ?? '0', 10),
    };
  }

  async getAllSnapshots(): Promise<MarketSnapshot[]> {
    const r = await this.pool.query(
      'SELECT player_id FROM market_prices ORDER BY player_id',
    );
    return Promise.all(r.rows.map(row => this.getSnapshot(row.player_id!)));
  }

  // ── Performans güncelleme ────────────────────────────────────────────────────

  async applyPerformance(playerId: PlayerId, coins: number, reason: string): Promise<number> {
    return this.pool.withTransaction(async (client) => {
      // Fiyat satırını kilitle
      const pr = await client.query(
        `SELECT mp.current_price, p.base_market_price
         FROM market_prices mp
         JOIN players p ON p.player_id = mp.player_id
         WHERE mp.player_id = $1 FOR UPDATE`,
        [playerId],
      );
      if (pr.rows.length === 0) throw new Error(`Oyuncu piyasada kayıtlı değil: ${playerId}`);

      const currentPrice = parseInt(pr.rows[0].current_price!, 10);
      const basePrice    = parseInt(pr.rows[0].base_market_price!, 10);

      // Son 3 performans event puanı
      const sr = await client.query(
        'SELECT coins FROM perf_events WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
        [playerId, SCORE_WINDOW],
      );
      const recentScores = sr.rows.map(r => parseInt(r.coins!, 10));

      // Son 20 talep eventi
      const dr = await client.query(
        'SELECT tx_type FROM demand_events WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
        [playerId, TRANSACTION_WIN],
      );
      const demandWindow = dr.rows.map(r => r.tx_type!);

      // Volatilite hesabı
      const avg     = recentScores.length > 0
        ? recentScores.reduce((s, n) => s + n, 0) / recentScores.length
        : basePrice * 0.05;
      const perfD   = clamp((coins - avg) / (avg || 1), -1, 1);
      const demD    = calcDemandDelta(demandWindow);
      const rawD    = perfD * PERF_WEIGHT + demD * DEMAND_WEIGHT;
      const delta   = clamp(rawD, -MAX_CHANGE, MAX_CHANGE);
      const newPrice = Math.max(MIN_PRICE, Math.round(currentPrice * (1 + delta)));

      await client.query(
        'UPDATE market_prices SET current_price = $1, last_updated = NOW() WHERE player_id = $2',
        [newPrice, playerId],
      );
      await client.query(
        'INSERT INTO price_history (player_id, price, reason) VALUES ($1, $2, $3)',
        [playerId, newPrice, reason],
      );
      await client.query(
        'INSERT INTO perf_events (player_id, coins) VALUES ($1, $2)',
        [playerId, coins],
      );

      return newPrice;
    });
  }

  // ── Alım/satım talep baskısı ─────────────────────────────────────────────────

  async recordBuy(playerId: PlayerId): Promise<void> {
    await this.pool.withTransaction(async (client) => {
      await client.query(
        'UPDATE market_prices SET total_buys = total_buys + 1, last_updated = NOW() WHERE player_id = $1',
        [playerId],
      );
      await client.query(
        'INSERT INTO demand_events (player_id, tx_type) VALUES ($1, $2)',
        [playerId, 'BUY'],
      );
      await this.updateDemandPrice(client, playerId, 'BUY_DEMAND');
    });
  }

  async recordSell(playerId: PlayerId): Promise<void> {
    await this.pool.withTransaction(async (client) => {
      await client.query(
        'UPDATE market_prices SET total_sells = total_sells + 1, last_updated = NOW() WHERE player_id = $1',
        [playerId],
      );
      await client.query(
        'INSERT INTO demand_events (player_id, tx_type) VALUES ($1, $2)',
        [playerId, 'SELL'],
      );
      await this.updateDemandPrice(client, playerId, 'SELL_SUPPLY');
    });
  }

  private async updateDemandPrice(
    client: { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string,string|null>[] }> },
    playerId: PlayerId,
    reason: string,
  ): Promise<void> {
    const pr = await client.query(
      'SELECT current_price FROM market_prices WHERE player_id = $1 FOR UPDATE',
      [playerId],
    );
    if (pr.rows.length === 0) return;
    const currentPrice = parseInt(pr.rows[0].current_price!, 10);

    const dr = await client.query(
      'SELECT tx_type FROM demand_events WHERE player_id = $1 ORDER BY id DESC LIMIT $2',
      [playerId, TRANSACTION_WIN],
    );
    const window   = dr.rows.map(r => r.tx_type!);
    const demD     = calcDemandDelta(window);
    const delta    = clamp(demD * DEMAND_WEIGHT, -MAX_CHANGE, MAX_CHANGE);
    const newPrice = Math.max(MIN_PRICE, Math.round(currentPrice * (1 + delta)));

    if (newPrice !== currentPrice) {
      await client.query(
        'UPDATE market_prices SET current_price = $1, last_updated = NOW() WHERE player_id = $2',
        [newPrice, playerId],
      );
      await client.query(
        'INSERT INTO price_history (player_id, price, reason) VALUES ($1, $2, $3)',
        [playerId, newPrice, reason],
      );
    }
  }

  // ── Fiyat geçmişi ────────────────────────────────────────────────────────────

  async getPriceHistory(playerId: PlayerId): Promise<PricePoint[]> {
    const r = await this.pool.query(
      'SELECT price, reason, created_at FROM price_history WHERE player_id = $1 ORDER BY id',
      [playerId],
    );
    return r.rows.map(row => ({
      price:     parseInt(row.price!, 10),
      reason:    row.reason!,
      timestamp: new Date(row.created_at!).getTime(),
    }));
  }

  private async price24hAgo(playerId: PlayerId, fallback: number): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const r = await this.pool.query(
      `SELECT price FROM price_history
       WHERE player_id = $1 AND created_at <= $2
       ORDER BY id DESC LIMIT 1`,
      [playerId, cutoff],
    );
    return r.rows.length > 0 ? parseInt(r.rows[0].price!, 10) : fallback;
  }
}

// ── Yardımcı fonksiyonlar ─────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

function calcDemandDelta(window: string[]): number {
  if (window.length === 0) return 0;
  const buys  = window.filter(t => t === 'BUY').length;
  const sells = window.filter(t => t === 'SELL').length;
  return (buys - sells) / (window.length + 1);
}
