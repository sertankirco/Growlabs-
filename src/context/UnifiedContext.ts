import { EventEmitter } from 'events';
import { randomUUID }   from 'crypto';

import { WalletEngine }   from '../wallet/WalletEngine';
import { SquadManager }   from '../wallet/SquadManager';
import { ExchangeEngine } from '../wallet/ExchangeEngine';
import { MarketEngine }   from '../market/MarketEngine';
import { EventPipeline }  from '../events/EventPipeline';
import { GameContext }     from './GameContext';
import { PgGameContext }   from './GameContext';
import { PgWalletEngine }  from '../db/PgWalletEngine';
import { PgSquadManager }  from '../db/PgSquadManager';
import { PgMarketEngine }  from '../db/PgMarketEngine';
import { PgExchangeEngine } from '../db/PgExchangeEngine';

import {
  UserId, PlayerId, TxId, TxType, Player, SlotType,
  Transaction, WalletSnapshot, SquadSnapshot, SquadEntry,
} from '../wallet/types';
import { MarketSnapshot, PricePoint } from '../market/MarketEngine';
import { MatchEvent, DispatchResult, MatchState } from '../events/types';
import { BuyResult, SellResult } from '../wallet/ExchangeEngine';

// ── UnifiedContext ────────────────────────────────────────────────────────────
//
// Tüm handler'ların kullandığı tek async arayüz.
// İki implementasyon:
//   • InMemoryUnifiedContext  — WalletEngine vb.'yi Promise.resolve ile sarar
//   • PgUnifiedContext        — PgWalletEngine vb. zaten async
//
// Bu sayede handlers.ts, her yerde await kullanır ve hangi backend'in
// kullanıldığından habersiz çalışır.

export interface IUnifiedWallet {
  createWallet(userId: UserId, initialBalance?: number): Promise<WalletSnapshot>;
  getWallet(userId: UserId): Promise<WalletSnapshot>;
  getAvailable(userId: UserId): Promise<number>;
  reserveFunds(userId: UserId, amount: number, key: string, txId?: TxId): Promise<Transaction>;
  commitReservation(txId: TxId): Promise<Transaction>;
  rollbackReservation(txId: TxId): Promise<Transaction>;
  credit(userId: UserId, amount: number, type: TxType, key: string, txId?: TxId, playerId?: string): Promise<Transaction>;
  getHistory(userId: UserId): Promise<Transaction[]>;
  getByIdempotencyKey(key: string): Promise<Transaction | undefined>;
  getLeaderboard(): Promise<Array<{ userId: string; balance: number; available: number }>>;
}

export interface IUnifiedSquad {
  createSquad(userId: UserId): Promise<void>;
  getSquad(userId: UserId): Promise<SquadSnapshot>;
  addPlayer(userId: UserId, player: Player, slot: SlotType): Promise<void>;
  removePlayer(userId: UserId, playerId: PlayerId): Promise<SquadEntry>;
  hasPlayer(userId: UserId, playerId: PlayerId): Promise<boolean>;
  getOwners(playerId: PlayerId): Promise<UserId[]>;
}

export interface IUnifiedMarket {
  registerPlayer(playerId: PlayerId, basePrice: number): Promise<void>;
  getPrice(playerId: PlayerId): Promise<number>;
  getSnapshot(playerId: PlayerId): Promise<MarketSnapshot>;
  getAllSnapshots(): Promise<MarketSnapshot[]>;
  applyPerformance(playerId: PlayerId, coins: number, reason: string): Promise<number>;
  recordBuy(playerId: PlayerId): Promise<void>;
  recordSell(playerId: PlayerId): Promise<void>;
  getPriceHistory(playerId: PlayerId): Promise<PricePoint[]>;
}

export interface IUnifiedExchange {
  getPrice(playerId: PlayerId): Promise<number>;
  buyPlayer(userId: UserId, player: Player, slot: SlotType, key: string): Promise<BuyResult>;
  sellPlayer(userId: UserId, playerId: PlayerId, key: string): Promise<SellResult>;
}

export interface IUnifiedPipeline extends EventEmitter {
  dispatch(event: MatchEvent): Promise<DispatchResult>;
  dispatchBatch(events: MatchEvent[]): Promise<DispatchResult[]>;
  startMatch(matchId: string, homeTeam: string, awayTeam: string): MatchState;
  finishMatch(matchId: string): MatchState;
  getMatch(matchId: string): MatchState;
}

export interface UnifiedContext {
  wallet:   IUnifiedWallet;
  squad:    IUnifiedSquad;
  market:   IUnifiedMarket;
  exchange: IUnifiedExchange;
  pipeline: IUnifiedPipeline;
  mode:     'memory' | 'postgres';
}

// ── In-Memory Adapter ─────────────────────────────────────────────────────────
//
// WalletEngine / SquadManager / MarketEngine'in sync metodlarını
// Promise.resolve() ile sararar → handlers aynı await kullanımıyla çalışır.

class MemWalletAdapter implements IUnifiedWallet {
  constructor(private readonly e: WalletEngine) {}
  async createWallet(u: UserId, b = 0)                        { return this.e.createWallet(u, b); }
  async getWallet(u: UserId)                                  { return this.e.getWallet(u); }
  async getAvailable(u: UserId)                               { return this.e.getAvailable(u); }
  async reserveFunds(u: UserId, a: number, k: string, t?: TxId) { return this.e.reserveFunds(u, a, k, t); }
  async commitReservation(t: TxId)                            { return this.e.commitReservation(t); }
  async rollbackReservation(t: TxId)                          { return this.e.rollbackReservation(t); }
  async credit(u: UserId, a: number, type: TxType, k: string, t?: TxId, p?: string) {
    return this.e.credit(u, a, type, k, t, p);
  }
  async getHistory(u: UserId)                                 { return this.e.getHistory(u); }
  async getByIdempotencyKey(k: string)                        { return this.e.getByIdempotencyKey(k); }
  async getLeaderboard()                                      { return this.e.getLeaderboard(); }
}

class MemSquadAdapter implements IUnifiedSquad {
  constructor(private readonly e: SquadManager) {}
  async createSquad(u: UserId): Promise<void>                 { this.e.createSquad(u); }
  async getSquad(u: UserId)                                   { return this.e.getSquad(u); }
  async addPlayer(u: UserId, p: Player, s: SlotType)          { return this.e.addPlayer(u, p, s); }
  async removePlayer(u: UserId, p: PlayerId)                  { return this.e.removePlayer(u, p); }
  async hasPlayer(u: UserId, p: PlayerId)                     { return this.e.hasPlayer(u, p); }
  async getOwners(p: PlayerId)                                { return this.e.getOwners(p); }
}

class MemMarketAdapter implements IUnifiedMarket {
  constructor(private readonly e: MarketEngine) {}
  async registerPlayer(p: PlayerId, b: number)               { return this.e.registerPlayer(p, b); }
  async getPrice(p: PlayerId)                                 { return this.e.getPrice(p); }
  async getSnapshot(p: PlayerId)                              { return this.e.getSnapshot(p); }
  async getAllSnapshots()                                      { return this.e.getAllSnapshots(); }
  async applyPerformance(p: PlayerId, c: number, r: string)  { return this.e.applyPerformance(p, c, r); }
  async recordBuy(p: PlayerId)                                { return this.e.recordBuy(p); }
  async recordSell(p: PlayerId)                               { return this.e.recordSell(p); }
  async getPriceHistory(p: PlayerId)                          { return this.e.getPriceHistory(p); }
}

class MemExchangeAdapter implements IUnifiedExchange {
  constructor(private readonly e: ExchangeEngine) {}
  async getPrice(p: PlayerId) {
    return this.e.getPrice(p);
  }
  async buyPlayer(u: UserId, p: Player, s: SlotType, k: string) {
    return this.e.buyPlayer(u, p, s, k);
  }
  async sellPlayer(u: UserId, p: PlayerId, k: string) {
    return this.e.sellPlayer(u, p, k);
  }
}

// ── Pg Adapter ────────────────────────────────────────────────────────────────
//
// Pg motorlar zaten async; sadece interface'e uygun şekilde wrap edilir.

class PgMarketAdapter implements IUnifiedMarket {
  constructor(private readonly e: PgMarketEngine) {}
  async registerPlayer(p: PlayerId, b: number)               { return this.e.registerPlayerFull(p, p, 'FWD', b); }
  async getPrice(p: PlayerId)                                 { return this.e.getPrice(p); }
  async getSnapshot(p: PlayerId)                              { return this.e.getSnapshot(p); }
  async getAllSnapshots()                                      { return this.e.getAllSnapshots(); }
  async applyPerformance(p: PlayerId, c: number, r: string)  { return this.e.applyPerformance(p, c, r); }
  async recordBuy(p: PlayerId)                                { return this.e.recordBuy(p); }
  async recordSell(p: PlayerId)                               { return this.e.recordSell(p); }
  async getPriceHistory(p: PlayerId)                          { return this.e.getPriceHistory(p); }
}

class PgExchangeAdapter implements IUnifiedExchange {
  constructor(private readonly e: PgExchangeEngine) {}
  async getPrice(p: PlayerId)                                              { return this.e.getPrice(p); }
  async buyPlayer(u: UserId, p: Player, s: SlotType, k: string)           { return this.e.buyPlayer(u, p, s, k); }
  async sellPlayer(u: UserId, p: PlayerId, k: string)                     { return this.e.sellPlayer(u, p, k); }
}

// ── Fabrikalar ────────────────────────────────────────────────────────────────

export function toUnifiedContext(ctx: GameContext): UnifiedContext {
  return {
    wallet:   new MemWalletAdapter(ctx.wallet),
    squad:    new MemSquadAdapter(ctx.squad),
    market:   new MemMarketAdapter(ctx.market),
    exchange: new MemExchangeAdapter(ctx.exchange),
    pipeline: ctx.pipeline as unknown as IUnifiedPipeline,
    mode:     'memory',
  };
}

export function pgToUnifiedContext(ctx: PgGameContext, pgPipeline: IUnifiedPipeline): UnifiedContext {
  return {
    wallet:   ctx.wallet,
    squad:    ctx.squad,
    market:   new PgMarketAdapter(ctx.market),
    exchange: new PgExchangeAdapter(ctx.exchange),
    pipeline: pgPipeline,
    mode:     'postgres',
  };
}
