import { randomUUID } from 'crypto';
import { PgWalletEngine } from './PgWalletEngine';
import { PgSquadManager } from './PgSquadManager';
import { PgMarketEngine }  from './PgMarketEngine';
import { UserId, PlayerId, Player, SlotType, Transaction } from '../wallet/types';
import { PlayerNotInMarketError } from '../wallet/errors';

export interface PgBuyResult  { transaction: Transaction; available: number; }
export interface PgSellResult { transaction: Transaction; available: number; }

// ── PgExchangeEngine ──────────────────────────────────────────────────────────
//
// ExchangeEngine'in tam async PostgreSQL versiyonu.
// Fiyat bilgisi PgMarketEngine'den çekilir; her işlem sonrası güncel fiyat yazar.

export class PgExchangeEngine {
  constructor(
    private readonly wallet: PgWalletEngine,
    private readonly squad:  PgSquadManager,
    private readonly market: PgMarketEngine,
  ) {}

  // ── Fiyat erişimi ─────────────────────────────────────────────────────────────

  async getPrice(playerId: PlayerId): Promise<number> {
    try {
      return await this.market.getPrice(playerId);
    } catch {
      throw new PlayerNotInMarketError(playerId);
    }
  }

  // ── Satın alma ───────────────────────────────────────────────────────────────

  async buyPlayer(
    userId:         UserId,
    player:         Player,
    slot:           SlotType,
    idempotencyKey: string = randomUUID(),
  ): Promise<PgBuyResult> {
    const price = await this.getPrice(player.id);
    const tx    = await this.wallet.reserveFunds(userId, price, idempotencyKey);

    if (tx.status === 'COMMITTED') {
      return { transaction: tx, available: await this.wallet.getAvailable(userId) };
    }

    try {
      await this.squad.addPlayer(userId, player, slot);
      const committed = await this.wallet.commitReservation(tx.txId);
      return { transaction: committed, available: await this.wallet.getAvailable(userId) };
    } catch (err) {
      await this.wallet.rollbackReservation(tx.txId);
      throw err;
    }
  }

  // ── Satış ─────────────────────────────────────────────────────────────────────

  async sellPlayer(
    userId:         UserId,
    playerId:       PlayerId,
    idempotencyKey: string = randomUUID(),
  ): Promise<PgSellResult> {
    const existing = await this.wallet.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { transaction: existing, available: await this.wallet.getAvailable(userId) };
    }

    await this.squad.removePlayer(userId, playerId);

    const sellPrice = await this.getPrice(playerId);
    const tx        = await this.wallet.credit(
      userId, sellPrice, 'SELL_PLAYER', idempotencyKey, randomUUID(), playerId,
    );

    return { transaction: tx, available: await this.wallet.getAvailable(userId) };
  }

  // ── Performans kazancı ────────────────────────────────────────────────────────

  async creditPerformance(
    userId:         UserId,
    playerId:       PlayerId,
    amount:         number,
    idempotencyKey: string,
  ): Promise<Transaction> {
    return this.wallet.credit(
      userId, amount, 'PERFORMANCE_EARNINGS', idempotencyKey, randomUUID(), playerId,
    );
  }

  // ── Para yatır ───────────────────────────────────────────────────────────────

  async deposit(
    userId:         UserId,
    amount:         number,
    idempotencyKey: string = randomUUID(),
  ): Promise<Transaction> {
    return this.wallet.credit(userId, amount, 'DEPOSIT', idempotencyKey);
  }
}
