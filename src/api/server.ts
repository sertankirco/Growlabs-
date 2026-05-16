import { createServer } from 'http';
import { HttpRouter }    from './HttpRouter';
import { buildHandlers } from './handlers';
import { createGameContext, registerPlayers, createPgContext, registerPgPlayers } from '../context/GameContext';
import { toUnifiedContext, pgToUnifiedContext, UnifiedContext } from '../context/UnifiedContext';
import { WsServer }           from '../ws/WsServer';
import { WORLD_CUP_PLAYERS }  from '../mock/MatchSimulator';
import { PlayerRegistry }     from '../feed/PlayerRegistry';
import { SportradarAdapter }  from '../feed/SportradarAdapter';
import { OptaAdapter }        from '../feed/OptaAdapter';
import { WebhookReceiver }    from '../feed/WebhookReceiver';
import { FeedReplay }         from '../feed/FeedReplay';
import { ProviderId }         from '../feed/types';
import { json }               from './HttpRouter';
import { PgPool, parseDatabaseUrl } from '../db/PgPool';
import { migrate }            from '../db/migrate';
import { EventPipeline }      from '../events/EventPipeline';

const PORT   = Number(process.env.PORT ?? 3000);
const DB_URL = process.env.DATABASE_URL;

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────
//
// DATABASE_URL varsa → PostgreSQL modu (kalıcı depolama, SELECT FOR UPDATE)
// Yoksa              → In-memory modu (testler, hızlı geliştirme)
//
// Her iki durumda da handlers aynı UnifiedContext arayüzünü kullanır.

let unified: UnifiedContext;
let activePipeline: EventPipeline | import('../db/PgEventPipeline').PgEventPipeline;

if (DB_URL) {
  // ── PostgreSQL modu ───────────────────────────────────────────────────────────
  console.log('🐘  DATABASE_URL algılandı — PostgreSQL modunda başlatılıyor...');
  const pool  = new PgPool(parseDatabaseUrl(DB_URL), 10);
  const pgCtx = createPgContext(pool);

  migrate(pool)
    .then(() => registerPgPlayers(pgCtx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice }))))
    .then(() => console.log(`✓ PostgreSQL hazır — ${WORLD_CUP_PLAYERS.length} oyuncu yüklendi`))
    .catch(err => { console.error('PostgreSQL başlatma hatası:', err.message); process.exit(1); });

  unified        = pgToUnifiedContext(pgCtx, pgCtx.pipeline as any);
  activePipeline = pgCtx.pipeline as any;
} else {
  // ── In-memory modu ────────────────────────────────────────────────────────────
  const ctx = createGameContext();
  registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));
  unified        = toUnifiedContext(ctx);
  activePipeline = ctx.pipeline;
}

const router   = new HttpRouter();
const wsServer = new WsServer(unified.pipeline as any);
const h        = buildHandlers(unified);

// ── Feed katmanı ──────────────────────────────────────────────────────────────

const registry    = new PlayerRegistry();
const srAdapter   = new SportradarAdapter(registry);
const optaAdapter = new OptaAdapter(registry);
const webhook     = new WebhookReceiver(activePipeline as any);
webhook.register(srAdapter);
webhook.register(optaAdapter);

// ── Route Tanımları ───────────────────────────────────────────────────────────

router.get ('/',                       h.health);
router.get ('/health',                 h.health);
router.get ('/players',                h.listPlayers);
router.get ('/market',                 h.marketAll);
router.get ('/market/:playerId',       h.marketPlayer);
router.post('/users',                  h.createUser);
router.get ('/wallet/:userId',         h.getWallet);
router.get ('/wallet/:userId/history', h.walletHistory);
router.get ('/squad/:userId',          h.getSquad);
router.post('/transfer/buy',           h.buyPlayer);
router.post('/transfer/sell',          h.sellPlayer);
router.post('/match/start',            h.startMatch);
router.post('/match/event',            h.pushMatchEvent);
router.get ('/leaderboard',            h.leaderboard);

router.get('/ws/stats', ({ res }) => {
  json(res, 200, { connections: wsServer.getConnectionCount(), timestamp: new Date().toISOString() });
});

router.post('/feed/webhook/:provider', async ({ req, res, params, query }) => {
  const provider = params.provider.toUpperCase() as ProviderId;
  const matchId  = query['matchId'] ?? query['match_id'] ?? 'unknown';
  await webhook.handle(req, res, provider, matchId);
});

router.post('/feed/replay/:scenario', async ({ res, params }) => {
  const scenario = params.scenario as 'final' | 'random';
  const replay   = new FeedReplay(activePipeline as any);
  replay.loadScenario(scenario);
  replay.start(50).catch(console.error);
  json(res, 202, { message: `Replay başlatıldı: ${scenario}`, note: 'Eventler WS üzerinden yayınlanacak' });
});

router.get('/feed/players', ({ res }) => {
  json(res, 200, { players: registry.getAll() });
});

// ── HTTP + WebSocket Sunucusu ─────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  router.handle(req, res).catch(err => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  });
});

wsServer.attach(server);

server.listen(PORT, () => {
  const mode = DB_URL ? '🐘 PostgreSQL' : '💾 In-Memory';
  console.log('\n⚽  World Cup 2026: Live Stock & Manager');
  console.log(`🚀  REST API:  http://localhost:${PORT}  [${mode}]`);
  console.log(`🔌  WebSocket: ws://localhost:${PORT}`);
  console.log(`📊  ${WORLD_CUP_PLAYERS.length} oyuncu piyasaya yüklendi\n`);
  console.log('Endpoint\'ler: /players /market /users /wallet/:id /squad/:id');
  console.log('Transfer:     POST /transfer/buy  |  /transfer/sell');
  console.log('Maç:          POST /match/start   |  /match/event');
  console.log('Sıralama:     GET  /leaderboard\n');
});

export { server, wsServer, unified };
