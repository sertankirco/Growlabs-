import { createServer } from 'http';
import { HttpRouter }    from './HttpRouter';
import { buildHandlers } from './handlers';
import { createGameContext, registerPlayers, createPgContext, registerPgPlayers } from '../context/GameContext';
import { toUnifiedContext, pgToUnifiedContext, UnifiedContext } from '../context/UnifiedContext';
import { WsServer }              from '../ws/WsServer';
import { WORLD_CUP_PLAYERS }     from '../mock/MatchSimulator';
import { PlayerRegistry }        from '../feed/PlayerRegistry';
import { SportradarAdapter }     from '../feed/SportradarAdapter';
import { OptaAdapter }           from '../feed/OptaAdapter';
import { WebhookReceiver }       from '../feed/WebhookReceiver';
import { ProviderId }            from '../feed/types';
import { json }                  from './HttpRouter';
import { PgPool, parseDatabaseUrl } from '../db/PgPool';
import { migrate }               from '../db/migrate';
import { LiveMatchOrchestrator } from '../match/LiveMatchOrchestrator';

const PORT   = Number(process.env.PORT ?? 3000);
const DB_URL = process.env.DATABASE_URL;

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────
//
// DATABASE_URL varsa → PostgreSQL modu (kalıcı depolama, SELECT FOR UPDATE)
// Yoksa              → In-memory modu (testler, hızlı geliştirme)
//
// Her iki durumda da handlers aynı UnifiedContext arayüzünü kullanır.

let unified: UnifiedContext;

if (DB_URL) {
  // ── PostgreSQL modu ───────────────────────────────────────────────────────────
  console.log('🐘  DATABASE_URL algılandı — PostgreSQL modunda başlatılıyor...');
  const pool  = new PgPool(parseDatabaseUrl(DB_URL), 10);
  const pgCtx = createPgContext(pool);

  migrate(pool)
    .then(() => registerPgPlayers(pgCtx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice }))))
    .then(() => console.log(`✓ PostgreSQL hazır — ${WORLD_CUP_PLAYERS.length} oyuncu yüklendi`))
    .catch(err => { console.error('PostgreSQL başlatma hatası:', err.message); process.exit(1); });

  unified = pgToUnifiedContext(pgCtx, pgCtx.pipeline as any);
} else {
  // ── In-memory modu ────────────────────────────────────────────────────────────
  const ctx = createGameContext();
  registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));
  unified = toUnifiedContext(ctx);
}

const router       = new HttpRouter();
const wsServer     = new WsServer(unified.pipeline as any);
const orchestrator = new LiveMatchOrchestrator(unified.pipeline);
const h            = buildHandlers(unified);

wsServer.wireOrchestrator(orchestrator);

// ── Feed katmanı ──────────────────────────────────────────────────────────────

const registry    = new PlayerRegistry();
const srAdapter   = new SportradarAdapter(registry);
const optaAdapter = new OptaAdapter(registry);
const webhook     = new WebhookReceiver(unified.pipeline as any);
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
router.post('/match/simulate',         ({ res, body }) => {
  const { scenario = 'random', speed = 1.0, matchId } = (body as any) ?? {};
  try {
    const id = orchestrator.startSimulation(scenario, Number(speed), matchId);
    json(res, 202, {
      matchId:   id,
      scenario,
      speed:     Number(speed),
      message:   `Simülasyon başlatıldı — ${Math.round(90 / speed)}sn sürecek`,
      wsChannel: `match:${id}`,
    });
  } catch (e: unknown) {
    json(res, 409, { error: (e as Error).message });
  }
});
router.get('/match/:matchId', ({ res, params }) => {
  const state = orchestrator.getMatchState(params.matchId);
  if (!state) { json(res, 404, { error: 'Maç bulunamadı' }); return; }
  json(res, 200, {
    ...state,
    running: orchestrator.isRunning(params.matchId),
  });
});
router.get('/matches', ({ res }) => {
  json(res, 200, { active: orchestrator.listActive() });
});
router.delete('/match/:matchId', ({ res, params }) => {
  const stopped = orchestrator.stopMatch(params.matchId);
  json(res, stopped ? 200 : 404, stopped
    ? { message: 'Maç durduruldu', matchId: params.matchId }
    : { error: 'Aktif maç bulunamadı' },
  );
});
router.get ('/leaderboard',            h.leaderboard);

router.get('/ws/stats', ({ res }) => {
  json(res, 200, { connections: wsServer.getConnectionCount(), timestamp: new Date().toISOString() });
});

router.post('/feed/webhook/:provider', async ({ req, res, params, query }) => {
  const provider = params.provider.toUpperCase() as ProviderId;
  const matchId  = query['matchId'] ?? query['match_id'] ?? 'unknown';
  await webhook.handle(req, res, provider, matchId);
});

router.post('/feed/replay/:scenario', ({ res, params }) => {
  const scenario = params.scenario as 'final' | 'random';
  try {
    const matchId = orchestrator.startSimulation(scenario, 50);
    json(res, 202, { matchId, message: `Replay başlatıldı: ${scenario}`, note: 'Eventler WS üzerinden yayınlanacak' });
  } catch (e: unknown) {
    json(res, 409, { error: (e as Error).message });
  }
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
  console.log('Maç:          POST /match/simulate  (oto) | /match/start (manuel)');
  console.log('              GET  /match/:matchId  |  GET  /matches');
  console.log('Sıralama:     GET  /leaderboard\n');

  // Sunucu hazır olunca otomatik maç döngüsü başlat
  autoMatchLoop();
});

// Her maç ~30 saniye (speed=3), ardından 15 saniye ara (MATCH_UPCOMING duyurusu), yeni maç.
// Kaldırmak için bu fonksiyonu ve çağrısını sil — başka hiçbir şey değişmez.
async function autoMatchLoop(): Promise<void> {
  const MATCH_SPEED  = 3;       // 1× = 90sn, 3× ≈ 30sn
  const BREAK_MS     = 15_000;  // maçlar arası bekleme

  while (true) {
    const matchId = orchestrator.startSimulation('random', MATCH_SPEED);
    console.log(`[AutoMatch] Maç başladı: ${matchId}`);

    await new Promise<void>(resolve => {
      orchestrator.once('match_full_time', ({ matchState }) => {
        if (matchState.matchId === matchId) resolve();
      });
    });

    console.log(`[AutoMatch] Maç bitti: ${matchId} — ${BREAK_MS / 1000}sn ara`);

    // Ara sırasında WS bağlı herkese sonraki maçı duyur
    orchestrator.announceUpcoming('random', BREAK_MS);

    await sleep(BREAK_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export { server, wsServer, unified };
