import { randomUUID } from 'crypto';
import { WalletEngine }  from './WalletEngine';
import { SquadManager }  from './SquadManager';
import { UserId, PlayerId, Player, SlotType, Transaction } from './types';
import { PlayerNotInMarketError } from './errors';

export interface BuyResult {
  transaction: Transaction;
  available:   number;
}

export interface SellResult {
  transaction: Transaction;
  available:   number;
}

// ── ExchangeEngine ────────────────────────────────────────────────────────────
//
// WalletEngine + SquadManager üzerine oturan orkestrasyon katmanı.
// İki aşamalı (reserve → commit / rollback) protokol ile çift harcamayı engeller:
//
//   SATIN ALMA:
//     1. reserveFunds()   → reserved artar, available düşer   (geri alınabilir kilit)
//     2. addPlayer()      → kadro güncellenir                 (hata olursa 3b çalışır)
//     3a commitReservation() → balance gerçekten düşer        (başarı yolu)
//     3b rollbackReservation() → reserved serbest bırakılır   (hata yolu)
//
//   SATIŞ:
//     1. removePlayer()   → oyuncu kadroda değil artık
//     2. credit()         → bakiye anında artar (COMMITTED, atomik)
//
// İdempotency key sayesinde ağ yeniden denemelerinde aynı işlem iki kez
// uygulanmaz; aynı key ile yapılan ikinci çağrı ilk sonucu döner.

export class ExchangeEngine {
  private readonly market = new Map<PlayerId, number>(); // playerId → fiyat

  constructor(
    private readonly wallet: WalletEngine,
    private readonly squad:  SquadManager,
  ) {}

  // ── Market yönetimi ──────────────────────────────────────────────────────────

  setPrice(playerId: PlayerId, price: number): void {
    this.market.set(playerId, price);
  }

  getPrice(playerId: PlayerId): number {
    const price = this.market.get(playerId);
    if (price === undefined) throw new PlayerNotInMarketError(playerId);
    return price;
  }

  updateMarketPrices(prices: Record<PlayerId, number>): void {
    for (const [id, price] of Object.entries(prices)) {
      this.market.set(id, price);
    }
  }

  // ── Satın alma ───────────────────────────────────────────────────────────────

  async buyPlayer(
    userId:         UserId,
    player:         Player,
    slot:           SlotType,
    idempotencyKey: string = randomUUID(),
  ): Promise<BuyResult> {
    const price = this.getPrice(player.id);

    // Aşama 1: Fonu rezerve et — bu adım geçilmeden bakiye değişmez
    const tx = await this.wallet.reserveFunds(userId, price, idempotencyKey);

    // İdempotency hit: tx zaten COMMITTED → ikinci kez işlem yapmadan dön
    if (tx.status === 'COMMITTED') {
      return { transaction: tx, available: this.wallet.getAvailable(userId) };
    }

    try {
      // Aşama 2: Kadro güncelle (kapasite / tekrar eden oyuncu hatası burada yakalanır)
      this.squad.addPlayer(userId, player, slot);

      // Aşama 3a: Rezervasyonu onayla, bakiyeyi düş
      const committed = await this.wallet.commitReservation(tx.txId);
      return { transaction: committed, available: this.wallet.getAvailable(userId) };

    } catch (err) {
      // Aşama 3b: Herhangi bir hata → kilidi aç, bakiye hiç değişmemiş sayılır
      await this.wallet.rollbackReservation(tx.txId);
      throw err;
    }
  }

  // ── Satış ─────────────────────────────────────────────────────────────────────

  async sellPlayer(
    userId:         UserId,
    playerId:       PlayerId,
    idempotencyKey: string = randomUUID(),
  ): Promise<SellResult> {
    // İdempotency hit: daha önce tamamlanmış satış işlemi → kadro/bakiye dokunulmadan dön
    const existing = this.wallet.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { transaction: existing, available: this.wallet.getAvailable(userId) };
    }

    // Kadro üyeliği önce doğrulanır (PlayerNotInSquadError), ardından piyasa fiyatı alınır
    this.squad.removePlayer(userId, playerId);

    const sellPrice = this.getPrice(playerId);

    // Bakiyeyi anında yaz (COMMITTED — geri alma gerekmez)
    const tx = await this.wallet.credit(
      userId,
      sellPrice,
      'SELL_PLAYER',
      idempotencyKey,
      randomUUID(),
      playerId,
    );

    return { transaction: tx, available: this.wallet.getAvailable(userId) };
  }

  // ── Performans kazancı (maç sonu otomatik kredi) ─────────────────────────────

  async creditPerformance(
    userId:         UserId,
    playerId:       PlayerId,
    amount:         number,
    idempotencyKey: string,
  ): Promise<Transaction> {
    return this.wallet.credit(
      userId,
      amount,
      'PERFORMANCE_EARNINGS',
      idempotencyKey,
      randomUUID(),
      playerId,
    );
  }

  // ── Para yatırma ─────────────────────────────────────────────────────────────

  async deposit(
    userId:         UserId,
    amount:         number,
    idempotencyKey: string = randomUUID(),
  ): Promise<Transaction> {
    return this.wallet.credit(userId, amount, 'DEPOSIT', idempotencyKey);
  }
}
