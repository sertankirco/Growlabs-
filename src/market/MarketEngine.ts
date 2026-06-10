import { PlayerId } from '../wallet/types';

// ── Piyasa Kaydı ──────────────────────────────────────────────────────────────

interface MarketRecord {
  playerId:           PlayerId;
  currentPrice:       number;
  basePrice:          number;
  recentScores:       number[];              // son 3 maç performans puanı (coin)
  recentTransactions: Array<'BUY'|'SELL'>;  // kayan pencere talep hesabı için
  totalBuys:          number;
  totalSells:         number;
  priceHistory:       PricePoint[];
  lastUpdated:        number;
}

export interface PricePoint {
  price:     number;
  timestamp: number;
  reason:    string;
}

export interface MarketSnapshot {
  playerId:     PlayerId;
  currentPrice: number;
  basePrice:    number;
  change24h:    number;   // son 24 saatteki % değişim
  trend:        'UP' | 'DOWN' | 'STABLE';
  totalBuys:    number;
  totalSells:   number;
}

// ── Volatilite Sabitleri ──────────────────────────────────────────────────────

const MAX_PRICE_CHANGE_RATIO = 0.20;   // tek bir event maks ±%20
const PERFORMANCE_WEIGHT     = 0.15;   // performans etkisi
const DEMAND_WEIGHT          = 0.04;   // arz-talep etkisi (0.10 fazla agresifti)
const MIN_PRICE              = 50;     // oyuncu fiyatı bu değerin altına düşemez
const SCORE_HISTORY_SIZE     = 5;      // son kaç maç dikkate alınır
const TRANSACTION_WINDOW     = 30;     // talep hesabında son kaç işlem

export class MarketEngine {
  private readonly records = new Map<PlayerId, MarketRecord>();

  // ── Oyuncu kaydı ─────────────────────────────────────────────────────────────

  registerPlayer(playerId: PlayerId, basePrice: number): void {
    if (this.records.has(playerId)) return;
    this.records.set(playerId, {
      playerId,
      currentPrice:       basePrice,
      basePrice,
      recentScores:       [],
      recentTransactions: [],
      totalBuys:          0,
      totalSells:         0,
      priceHistory:       [{ price: basePrice, timestamp: Date.now(), reason: 'INIT' }],
      lastUpdated:        Date.now(),
    });
  }

  getPrice(playerId: PlayerId): number {
    return this.requireRecord(playerId).currentPrice;
  }

  getSnapshot(playerId: PlayerId): MarketSnapshot {
    const r     = this.requireRecord(playerId);
    const prev  = this.price24hAgo(r);
    const delta = prev > 0 ? ((r.currentPrice - prev) / prev) * 100 : 0;
    return {
      playerId:     r.playerId,
      currentPrice: r.currentPrice,
      basePrice:    r.basePrice,
      change24h:    Math.round(delta * 100) / 100,
      trend:        delta > 1 ? 'UP' : delta < -1 ? 'DOWN' : 'STABLE',
      totalBuys:    r.totalBuys,
      totalSells:   r.totalSells,
    };
  }

  getAllSnapshots(): MarketSnapshot[] {
    return [...this.records.keys()].map(id => this.getSnapshot(id));
  }

  // ── Performans güncelleme (bir event sonrası) ─────────────────────────────────
  //
  // Fiyat formülü:
  //   delta = performanceDelta * PERFORMANCE_WEIGHT
  //         + demandDelta      * DEMAND_WEIGHT
  //
  //   performanceDelta = (coins - avgRecentScore) / (avgRecentScore || basePrice)
  //   demandDelta      = (buys - sells) / (buys + sells + 1)
  //
  // Her iki bileşen de MAX_PRICE_CHANGE_RATIO ile kırpılır.

  applyPerformance(playerId: PlayerId, coins: number, reason: string): number {
    const r     = this.requireRecord(playerId);
    // İlk maçta geçmiş yok: baz fiyatın küçük bir yüzdesi referans alınır
    // Pozitif coin = iyi performans → fiyat artar
    const avg   = r.recentScores.length > 0
      ? this.avg(r.recentScores)
      : r.basePrice * 0.05;   // düşük eşik: GOL (200) > 150 → UP
    const perfD = this.clamp((coins - avg) / (avg || 1), -1, 1);
    const demD  = this.demandDelta(r);

    const rawDelta = perfD * PERFORMANCE_WEIGHT + demD * DEMAND_WEIGHT;
    const delta    = this.clamp(rawDelta, -MAX_PRICE_CHANGE_RATIO, MAX_PRICE_CHANGE_RATIO);

    const newPrice = Math.max(MIN_PRICE, Math.round(r.currentPrice * (1 + delta)));
    this.applyPrice(r, newPrice, reason);

    r.recentScores.push(coins);
    if (r.recentScores.length > SCORE_HISTORY_SIZE) r.recentScores.shift();

    return newPrice;
  }

  // ── Alım/satım arz-talep güncellemesi ─────────────────────────────────────────

  recordBuy(playerId: PlayerId): void {
    const r = this.requireRecord(playerId);
    r.totalBuys += 1;
    r.recentTransactions.push('BUY');
    if (r.recentTransactions.length > TRANSACTION_WINDOW) r.recentTransactions.shift();
    const demD  = this.demandDelta(r);
    const delta = this.clamp(demD * DEMAND_WEIGHT, -MAX_PRICE_CHANGE_RATIO, MAX_PRICE_CHANGE_RATIO);
    const newPrice = Math.max(MIN_PRICE, Math.round(r.currentPrice * (1 + delta)));
    if (newPrice !== r.currentPrice) this.applyPrice(r, newPrice, 'BUY_DEMAND');
  }

  recordSell(playerId: PlayerId): void {
    const r = this.requireRecord(playerId);
    r.totalSells += 1;
    r.recentTransactions.push('SELL');
    if (r.recentTransactions.length > TRANSACTION_WINDOW) r.recentTransactions.shift();
    const demD  = this.demandDelta(r);
    const delta = this.clamp(demD * DEMAND_WEIGHT, -MAX_PRICE_CHANGE_RATIO, MAX_PRICE_CHANGE_RATIO);
    const newPrice = Math.max(MIN_PRICE, Math.round(r.currentPrice * (1 + delta)));
    if (newPrice !== r.currentPrice) this.applyPrice(r, newPrice, 'SELL_SUPPLY');
  }

  getPriceHistory(playerId: PlayerId): PricePoint[] {
    return [...this.requireRecord(playerId).priceHistory];
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private applyPrice(r: MarketRecord, newPrice: number, reason: string): void {
    r.currentPrice = newPrice;
    r.lastUpdated  = Date.now();
    r.priceHistory.push({ price: newPrice, timestamp: Date.now(), reason });
    if (r.priceHistory.length > 200) r.priceHistory.shift(); // bellek koru
  }

  private demandDelta(r: MarketRecord): number {
    // Kayan pencere: son TRANSACTION_WINDOW işlemde alım/satım dengesi
    const window = r.recentTransactions;
    if (window.length === 0) return 0;
    const buys  = window.filter(t => t === 'BUY').length;
    const sells = window.filter(t => t === 'SELL').length;
    return (buys - sells) / (window.length + 1);
  }

  private avg(nums: number[]): number {
    if (nums.length === 0) return 0;
    return nums.reduce((s, n) => s + n, 0) / nums.length;
  }

  private clamp(val: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, val));
  }

  private price24hAgo(r: MarketRecord): number {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const old    = r.priceHistory.filter(p => p.timestamp <= cutoff);
    return old.length > 0 ? old[old.length - 1].price : r.priceHistory[0].price;
  }

  private requireRecord(playerId: PlayerId): MarketRecord {
    const r = this.records.get(playerId);
    if (!r) throw new Error(`Oyuncu piyasada kayıtlı değil: ${playerId}`);
    return r;
  }
}
