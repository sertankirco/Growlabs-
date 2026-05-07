import { WalletEngine }   from '../wallet/WalletEngine';
import { SquadManager }   from '../wallet/SquadManager';
import { ExchangeEngine } from '../wallet/ExchangeEngine';
import { MarketEngine }   from '../market/MarketEngine';
import { EventPipeline }  from '../events/EventPipeline';
import { Player, UserId } from '../wallet/types';
import { PgPool }          from '../db/PgPool';
import { PgWalletEngine }  from '../db/PgWalletEngine';
import { PgSquadManager }  from '../db/PgSquadManager';
import { PgMarketEngine }  from '../db/PgMarketEngine';
import { PgExchangeEngine } from '../db/PgExchangeEngine';

// ── GameContext ───────────────────────────────────────────────────────────────
//
// Tüm bileşenleri tek bir yerden oluşturan ve birbirine bağlayan fabrika.
// Üretimde bu sınıf DI container'ın yerini tutar; testlerde kolayca izole
// edilebilir (her test fresh bir context alır).

export interface GameContext {
  wallet:   WalletEngine;
  squad:    SquadManager;
  exchange: ExchangeEngine;
  market:   MarketEngine;
  pipeline: EventPipeline;
}

export function createGameContext(): GameContext {
  const wallet   = new WalletEngine();
  const squad    = new SquadManager();
  const market   = new MarketEngine();
  const exchange = new ExchangeEngine(wallet, squad);
  const pipeline = new EventPipeline(wallet, squad, market);

  // ExchangeEngine fiyat sorgularını market'e yönlendir
  wireExchangeToMarket(exchange, market);

  return { wallet, squad, exchange, market, pipeline };
}

// ── Kullanıcı hızlı başlatma yardımcısı ──────────────────────────────────────

export function bootstrapUser(
  ctx:            GameContext,
  userId:         UserId,
  initialBalance: number,
): void {
  ctx.wallet.createWallet(userId, initialBalance);
  ctx.squad.createSquad(userId);
}

// ── Oyuncu piyasaya kayıt yardımcısı ─────────────────────────────────────────

export function registerPlayers(
  ctx:     GameContext,
  players: Array<{ player: Player; basePrice: number }>,
): void {
  for (const { player, basePrice } of players) {
    ctx.market.registerPlayer(player.id, basePrice);
    ctx.exchange.setPrice(player.id, basePrice);
  }
}

// ── PostgreSQL-backed context ─────────────────────────────────────────────────
//
// createPgContext(pool) → tüm motorlar veritabanına yazılır.
// Double-spend önleme: SELECT FOR UPDATE (WalletEngine'deki mutex'in yerini alır).
// Yatay ölçekleme: birden fazla sunucu aynı DB'ye bağlanabilir.

export interface PgGameContext {
  wallet:   PgWalletEngine;
  squad:    PgSquadManager;
  exchange: PgExchangeEngine;
  market:   PgMarketEngine;
  pool:     PgPool;
}

export function createPgContext(pool: PgPool): PgGameContext {
  const wallet   = new PgWalletEngine(pool);
  const squad    = new PgSquadManager(pool);
  const market   = new PgMarketEngine(pool);
  const exchange = new PgExchangeEngine(wallet, squad, market);
  return { wallet, squad, exchange, market, pool };
}

export async function bootstrapPgUser(
  ctx:            PgGameContext,
  userId:         UserId,
  initialBalance: number,
): Promise<void> {
  await ctx.wallet.createWallet(userId, initialBalance);
  await ctx.squad.createSquad(userId);
}

export async function registerPgPlayers(
  ctx:     PgGameContext,
  players: Array<{ player: Player; basePrice: number }>,
): Promise<void> {
  for (const { player, basePrice } of players) {
    await ctx.market.registerPlayerFull(
      player.id, player.name, player.position, basePrice,
    );
  }
}

// ── Market fiyatları ExchangeEngine'e yansıt ─────────────────────────────────
//
// MarketEngine fiyatları değiştirdiğinde ExchangeEngine'i de günceller.
// Production'da bu bir event subscription ile yapılır.

function wireExchangeToMarket(exchange: ExchangeEngine, market: MarketEngine): void {
  const originalApply = market.applyPerformance.bind(market);
  market.applyPerformance = (playerId, coins, reason) => {
    const newPrice = originalApply(playerId, coins, reason);
    exchange.setPrice(playerId, newPrice);
    return newPrice;
  };

  const originalBuy = market.recordBuy.bind(market);
  market.recordBuy = (playerId) => {
    originalBuy(playerId);
    try { exchange.setPrice(playerId, market.getPrice(playerId)); } catch { /* henüz kayıtlı değil */ }
  };

  const originalSell = market.recordSell.bind(market);
  market.recordSell = (playerId) => {
    originalSell(playerId);
    try { exchange.setPrice(playerId, market.getPrice(playerId)); } catch { /* henüz kayıtlı değil */ }
  };
}
