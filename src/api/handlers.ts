import { randomUUID } from 'crypto';
import { RouteContext, json } from './HttpRouter';
import { GameContext, bootstrapUser } from '../context/GameContext';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';
import { MatchEvent } from '../events/types';
import { Player } from '../wallet/types';

// ── Handler Fabrikası ─────────────────────────────────────────────────────────
//
// Her handler factory, paylaşılan GameContext üzerinde çalışır.
// Stateless'tır — state yalnızca GameContext içindedir.

export function buildHandlers(ctx: GameContext) {

  // GET /health
  function health({ res }: RouteContext) {
    json(res, 200, {
      status:    'ok',
      game:      'World Cup 2026: Live Stock & Manager',
      timestamp: new Date().toISOString(),
    });
  }

  // GET /market
  function marketAll({ res }: RouteContext) {
    json(res, 200, { players: ctx.market.getAllSnapshots() });
  }

  // GET /market/:playerId
  function marketPlayer({ res, params }: RouteContext) {
    try {
      const snap    = ctx.market.getSnapshot(params.playerId);
      const history = ctx.market.getPriceHistory(params.playerId).slice(-20);
      json(res, 200, { ...snap, priceHistory: history });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // POST /users  { userId, initialBalance }
  function createUser({ res, body }: RouteContext) {
    const { userId, initialBalance = 5000 } = (body as any) ?? {};
    if (!userId) { json(res, 400, { error: 'userId zorunlu' }); return; }
    try {
      bootstrapUser(ctx, userId, initialBalance);
      json(res, 201, { userId, initialBalance, message: 'Kullanıcı oluşturuldu' });
    } catch (e: unknown) {
      json(res, 409, { error: (e as Error).message });
    }
  }

  // GET /wallet/:userId
  function getWallet({ res, params }: RouteContext) {
    try {
      const snap      = ctx.wallet.getWallet(params.userId);
      const available = ctx.wallet.getAvailable(params.userId);
      json(res, 200, { ...snap, available });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // GET /wallet/:userId/history
  function walletHistory({ res, params }: RouteContext) {
    try {
      const history = ctx.wallet.getHistory(params.userId);
      json(res, 200, { userId: params.userId, transactions: history });
    } catch (e: unknown) {
      json(res, 404, { error: (e as Error).message });
    }
  }

  // GET /squad/:userId
  function getSquad({ res, params }: RouteContext) {
    try {
      const snap = ctx.squad.getSquad(params.userId);
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
      ctx.market.recordBuy(playerId);
      json(res, 200, {
        transaction:  result.transaction,
        available:    result.available,
        newPrice:     ctx.market.getPrice(playerId),
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
      ctx.market.recordSell(playerId);
      json(res, 200, {
        transaction: result.transaction,
        available:   result.available,
        newPrice:    ctx.market.getPrice(playerId),
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
      matchId,
      playerId,
      position,
      type,
      minute,
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
  function leaderboard({ res }: RouteContext) {
    // Tüm kullanıcıların cüzdanlarını WalletEngine'den çek
    // (production'da ayrı bir leaderboard cache servisi tutar)
    const walletEngine = ctx.wallet as any;
    const entries: Array<{ userId: string; balance: number; available: number }> = [];

    if (walletEngine['wallets']) {
      for (const [userId, record] of walletEngine['wallets'].entries()) {
        entries.push({
          userId,
          balance:   record.balance,
          available: record.balance - record.reserved,
        });
      }
    }

    entries.sort((a, b) => b.available - a.available);
    json(res, 200, {
      leaderboard: entries.map((e, i) => ({ rank: i + 1, ...e })),
      updatedAt:   new Date().toISOString(),
    });
  }

  // GET /players
  function listPlayers({ res }: RouteContext) {
    const players = WORLD_CUP_PLAYERS.map(p => ({
      ...p,
      currentPrice: (() => {
        try { return ctx.market.getPrice(p.id); } catch { return p.marketPrice; }
      })(),
    }));
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
