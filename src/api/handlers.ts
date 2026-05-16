import { randomUUID } from 'crypto';
import { RouteContext, json } from './HttpRouter';
import { UnifiedContext } from '../context/UnifiedContext';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';
import { MatchEvent } from '../events/types';
import { signToken } from '../auth/jwt';
import { assertSelf, JWT_SECRET } from '../auth/middleware';

// ── Handler Fabrikası ─────────────────────────────────────────────────────────
//
// Korumalı endpoint'ler requireAuth() sarmalayıcısı ile server.ts'de wrap edilir.
// Handler içinde assertSelf() ile token'daki userId ile istekteki userId eşleşmesi
// kontrol edilir.

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
  // Herkese açık — kullanıcı oluşturur ve JWT döner
  async function createUser({ res, body }: RouteContext) {
    const { userId, initialBalance = 5000 } = (body as any) ?? {};
    if (!userId) { json(res, 400, { error: 'userId zorunlu' }); return; }
    try {
      await ctx.wallet.createWallet(userId, initialBalance);
      await ctx.squad.createSquad(userId);
      const token = signToken(userId, JWT_SECRET);
      json(res, 201, { userId, initialBalance, token, message: 'Kullanıcı oluşturuldu' });
    } catch (e: unknown) {
      json(res, 409, { error: (e as Error).message });
    }
  }

  // POST /auth/login  { userId }
  // Var olan kullanıcıya token ver (dev/demo kolaylığı)
  async function login({ res, body }: RouteContext) {
    const { userId } = (body as any) ?? {};
    if (!userId) { json(res, 400, { error: 'userId zorunlu' }); return; }
    try {
      await ctx.wallet.getWallet(userId);   // var mı kontrol et
      const token = signToken(userId, JWT_SECRET);
      json(res, 200, { userId, token });
    } catch {
      json(res, 404, { error: 'Kullanıcı bulunamadı' });
    }
  }

  // GET /wallet/:userId  [korumalı — sadece kendi cüzdanı]
  async function getWallet(ctx2: RouteContext) {
    if (!assertSelf(ctx2, ctx2.params.userId)) return;
    try {
      const snap      = await ctx.wallet.getWallet(ctx2.params.userId);
      const available = await ctx.wallet.getAvailable(ctx2.params.userId);
      json(ctx2.res, 200, { ...snap, available });
    } catch (e: unknown) {
      json(ctx2.res, 404, { error: (e as Error).message });
    }
  }

  // GET /wallet/:userId/history  [korumalı]
  async function walletHistory(ctx2: RouteContext) {
    if (!assertSelf(ctx2, ctx2.params.userId)) return;
    try {
      const history = await ctx.wallet.getHistory(ctx2.params.userId);
      json(ctx2.res, 200, { userId: ctx2.params.userId, transactions: history });
    } catch (e: unknown) {
      json(ctx2.res, 404, { error: (e as Error).message });
    }
  }

  // GET /squad/:userId  [korumalı]
  async function getSquad(ctx2: RouteContext) {
    if (!assertSelf(ctx2, ctx2.params.userId)) return;
    try {
      const snap = await ctx.squad.getSquad(ctx2.params.userId);
      json(ctx2.res, 200, snap);
    } catch (e: unknown) {
      json(ctx2.res, 404, { error: (e as Error).message });
    }
  }

  // POST /transfer/buy  { playerId, slot, idempotencyKey? }  [korumalı]
  // userId artık body'den değil, token'dan alınır
  async function buyPlayer(ctx2: RouteContext) {
    const userId = ctx2.authUserId!;
    const { playerId, slot = 'starting', idempotencyKey } = (ctx2.body as any) ?? {};
    if (!playerId) { json(ctx2.res, 400, { error: 'playerId zorunlu' }); return; }

    const player = WORLD_CUP_PLAYERS.find(p => p.id === playerId);
    if (!player) { json(ctx2.res, 404, { error: `Oyuncu bulunamadı: ${playerId}` }); return; }

    try {
      const result = await ctx.exchange.buyPlayer(
        userId, player, slot, idempotencyKey ?? randomUUID(),
      );
      await ctx.market.recordBuy(playerId);
      json(ctx2.res, 200, {
        transaction: result.transaction,
        available:   result.available,
        newPrice:    await ctx.market.getPrice(playerId),
      });
    } catch (e: unknown) {
      json(ctx2.res, 422, { error: (e as Error).message });
    }
  }

  // POST /transfer/sell  { playerId, idempotencyKey? }  [korumalı]
  async function sellPlayer(ctx2: RouteContext) {
    const userId = ctx2.authUserId!;
    const { playerId, idempotencyKey } = (ctx2.body as any) ?? {};
    if (!playerId) { json(ctx2.res, 400, { error: 'playerId zorunlu' }); return; }

    try {
      const result = await ctx.exchange.sellPlayer(
        userId, playerId, idempotencyKey ?? randomUUID(),
      );
      await ctx.market.recordSell(playerId);
      json(ctx2.res, 200, {
        transaction: result.transaction,
        available:   result.available,
        newPrice:    await ctx.market.getPrice(playerId),
      });
    } catch (e: unknown) {
      json(ctx2.res, 422, { error: (e as Error).message });
    }
  }

  // POST /match/event  [korumalı — admin işlemi]
  async function pushMatchEvent({ res, body }: RouteContext) {
    const { matchId, playerId, position, type, minute = 45 } = (body as any) ?? {};
    if (!matchId || !playerId || !position || !type) {
      json(res, 400, { error: 'matchId, playerId, position, type zorunlu' }); return;
    }
    const event: MatchEvent = {
      eventId: randomUUID(), matchId, playerId, position, type, minute,
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

  // POST /match/start
  function startMatch({ res, body }: RouteContext) {
    const { matchId = randomUUID(), homeTeam = 'Ev Sahibi', awayTeam = 'Misafir' } = (body as any) ?? {};
    const state = ctx.pipeline.startMatch(matchId, homeTeam, awayTeam);
    json(res, 201, state);
  }

  // GET /leaderboard  [herkese açık]
  async function leaderboard({ res }: RouteContext) {
    const entries = await ctx.wallet.getLeaderboard();
    json(res, 200, {
      leaderboard: entries.map((e, i) => ({ rank: i + 1, ...e })),
      updatedAt:   new Date().toISOString(),
    });
  }

  // GET /players  [herkese açık]
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
    createUser, login,
    getWallet, walletHistory,
    getSquad,
    buyPlayer, sellPlayer,
    pushMatchEvent, startMatch,
    leaderboard,
    listPlayers,
  };
}
