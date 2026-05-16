import { randomUUID } from 'crypto';
import { RouteContext, json } from './HttpRouter';
import { UnifiedContext } from '../context/UnifiedContext';
import { bootstrapUser } from '../context/GameContext';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';
import { MatchEvent } from '../events/types';
import { Player } from '../wallet/types';

// ── Handler Fabrikası ─────────────────────────────────────────────────────────
//
// Tüm handler'lar UnifiedContext üzerinde çalışır.
// Her metot await ile çağrılır — in-memory ve PostgreSQL backend'leri için
// aynı kod çalışır (UnifiedContext Promise döner her zaman).

export function buildHandlers(ctx: UnifiedContext) {

  // GET /health
  function health({ res }: RouteContext) {
    json(res, 200, {
      status:    'ok',
      game:      'World Cup 2026: Live Stock & Manager',
      backend:   ctx.mode,
      timestamp: new Date().toISOString(),
    });
  }

  // GET /market
  async function marketAll({ res }: RouteContext) {
    json(res, 200, { players: await ctx.market.getAllSnapshots() });
  }

  // GET /market/:playerId
  async function marketPlayer({ res, params }: RouteContext) {
    try {
      const snap    = await ctx.market.getSnapshot(params.playerId);
      const history = (await ctx.market.getPriceHistory(params.playerId)).slice(-20);
      json(res, 200, { ...snap, priceHistory: history });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // POST /users  { userId, initialBalance }
  async function createUser({ res, body }: RouteContext) {
    const { userId, initialBalance = 5000 } = (body as any) ?? {};
    if (!userId) { json(res, 400, { error: 'userId zorunlu' }); return; }
    try {
      await ctx.wallet.createWallet(userId, initialBalance);
      await ctx.squad.createSquad(userId);
      json(res, 201, { userId, initialBalance, message: 'Kullanıcı oluşturuldu' });
    } catch (e: unknown) {
      json(res, 409, { error: (e as Error).message });
    }
  }

  // GET /wallet/:userId
  async function getWallet({ res, params }: RouteContext) {
    try {
      const snap      = await ctx.wallet.getWallet(params.userId);
      const available = await ctx.wallet.getAvailable(params.userId);
      json(res, 200, { ...snap, available });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // GET /wallet/:userId/history
  async function walletHistory({ res, params }: RouteContext) {
    try {
      const history = await ctx.wallet.getHistory(params.userId);
      json(res, 200, { userId: params.userId, transactions: history });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // GET /squad/:userId
  async function getSquad({ res, params }: RouteContext) {
    try {
      const snap = await ctx.squad.getSquad(params.userId);
      json(res, 200, snap);
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // POST /transfer/buy  { userId, playerId, slot, idempotencyKey? }
  async function buyPlayer({ res, body }: RouteContext) {
    const { userId, playerId, slot = 'starting', idempotencyKey } = (body as any) ?? {};
    if (!userId || !playerId) { json(res, 400, { error: 'userId ve playerId zorunlu' }); return; }

    const player = WORLD_CUP_PLAYERS.find(p => p.id === playerId);
    if (!player) { json(res, 404, { error: `Oyuncu bulunamadı: ${playerId}` }); return; }

    try {
      const result = await ctx.exchange.buyPlayer(
        userId, player, slot, idempotencyKey ?? randomUUID(),
      );
      await ctx.market.recordBuy(playerId);
      json(res, 200, {
        transaction: result.transaction,
        available:   result.available,
        newPrice:    await ctx.market.getPrice(playerId),
      });
    } catch (e: unknown) {
      json(res, 422, { error: (e as Error).message });
    }
  }

  // POST /transfer/sell  { userId, playerId, idempotencyKey? }
  async function sellPlayer({ res, body }: RouteContext) {
    const { userId, playerId, idempotencyKey } = (body as any) ?? {};
    if (!userId || !playerId) { json(res, 400, { error: 'userId ve playerId zorunlu' }); return; }

    try {
      const result = await ctx.exchange.sellPlayer(
        userId, playerId, idempotencyKey ?? randomUUID(),
      );
      await ctx.market.recordSell(playerId);
      json(res, 200, {
        transaction: result.transaction,
        available:   result.available,
        newPrice:    await ctx.market.getPrice(playerId),
      });
    } catch (e: unknown) {
      json(res, 422, { error: (e as Error).message });
    }
  }

  // POST /match/event  { matchId, playerId, position, type, minute }
  async function pushMatchEvent({ res, body }: RouteContext) {
    const { matchId, playerId, position, type, minute = 45 } = (body as any) ?? {};
    if (!matchId || !playerId || !position || !type) {
      json(res, 400, { error: 'matchId, playerId, position, type zorunlu' }); return;
    }

    const event: MatchEvent = {
      eventId:   randomUUID(),
      matchId, playerId, position, type, minute,
      timestamp: Date.now(),
    };

    try {
      const result = await ctx.pipeline.dispatch(event);
      json(res, 200, {
        eventId:        event.eventId,
        reward:         result.reward,
        affectedUsers:  result.affectedUsers,
        creditsApplied: result.creditsApplied,
        newMarketPrice: result.newMarketPrice,
        durationMs:     result.durationMs,
      });
    } catch (e: unknown) {
      json(res, 422, { error: (e as Error).message });
    }
  }

  // POST /match/start  { matchId, homeTeam, awayTeam }
  function startMatch({ res, body }: RouteContext) {
    const { matchId = randomUUID(), homeTeam = 'Ev Sahibi', awayTeam = 'Misafir' } = (body as any) ?? {};
    const state = ctx.pipeline.startMatch(matchId, homeTeam, awayTeam);
    json(res, 201, state);
  }

  // GET /leaderboard
  async function leaderboard({ res }: RouteContext) {
    const entries = await ctx.wallet.getLeaderboard();
    json(res, 200, {
      leaderboard: entries.map((e, i) => ({ rank: i + 1, ...e })),
      updatedAt:   new Date().toISOString(),
    });
  }

  // GET /players
  async function listPlayers({ res }: RouteContext) {
    const players = await Promise.all(
      WORLD_CUP_PLAYERS.map(async p => ({
        ...p,
        currentPrice: await ctx.market.getPrice(p.id).catch(() => p.marketPrice),
      })),
    );
    json(res, 200, { players });
  }

  return {
    health,
    marketAll, marketPlayer,
    createUser,
    getWallet, walletHistory,
    getSquad,
    buyPlayer, sellPlayer,
    pushMatchEvent, startMatch,
    leaderboard,
    listPlayers,
  };
}
