import { createServer }   from 'http';
import { readFileSync }    from 'fs';
import { join }            from 'path';
import { HttpRouter }      from './HttpRouter';
import { buildHandlers }   from './handlers';
import { requireAuth }     from '../auth/middleware';
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
import { PgSubscriber }          from '../db/PgSubscriber';
import { RateLimiter }           from './RateLimiter';
import { Metrics }               from './Metrics';
import { runLoadTest }           from './LoadTester';
import { randomUUID }            from 'crypto';

// Startup'ta bir kez oku — route istekte tekrar okumaz
const UI_HTML = readFileSync(join(__dirname, '../../public/index.html'), 'utf8');

const PORT         = Number(process.env.PORT ?? 3000);
const DB_URL       = process.env.DATABASE_URL;
const ADMIN_SECRET = process.env.ADMIN_SECRET ?? 'wc2026-admin-change-in-prod';

// Dakikada 120 istek (genel) / 10 istek (auth — brute-force koruması)
const apiRl   = new RateLimiter(120, 60_000);
const authRl  = new RateLimiter(10,  60_000);
const metrics = new Metrics();

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────
//
// DATABASE_URL varsa → PostgreSQL modu (kalıcı depolama, SELECT FOR UPDATE)
// Yoksa              → In-memory modu (testler, hızlı geliştirme)
//
// Her iki durumda da handlers aynı UnifiedContext arayüzünü kullanır.

let unified: UnifiedContext;
let pgWireCallback: ((ws: WsServer) => void) | undefined;
let pgPoolRef:      PgPool       | undefined;   // shutdown için
let pgSubRef:       PgSubscriber | undefined;   // shutdown için
let shuttingDown = false;

if (DB_URL) {
  // ── PostgreSQL modu ───────────────────────────────────────────────────────────
  console.log('🐘  DATABASE_URL algılandı — PostgreSQL modunda başlatılıyor...');
  const dbCfg   = parseDatabaseUrl(DB_URL);
  const poolSize = Number(process.env.PG_POOL_SIZE ?? 10);
  const pool     = new PgPool(dbCfg, poolSize);
  const pgCtx = createPgContext(pool);
  pgPoolRef   = pool;

  unified = pgToUnifiedContext(pgCtx, pgCtx.pipeline as any);

  pgWireCallback = (ws: WsServer) => {
    const subscriber = new PgSubscriber();
    pgSubRef = subscriber;
    migrate(pool)
      .then(() => registerPgPlayers(pgCtx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice }))))
      .then(() => subscriber.start(dbCfg, ['wc2026_events']))
      .then(() => {
        ws.wirePgSubscriber(subscriber);
        console.log(`✓ PostgreSQL hazır — ${WORLD_CUP_PLAYERS.length} oyuncu yüklendi`);
      })
      .catch(err => { console.error('PostgreSQL başlatma hatası:', err.message); process.exit(1); });
  };
} else {
  // ── In-memory modu ────────────────────────────────────────────────────────────
  const ctx = createGameContext();
  registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));
  unified = toUnifiedContext(ctx);
}

const router       = new HttpRouter();
const wsServer     = new WsServer(unified);
const orchestrator = new LiveMatchOrchestrator(unified.pipeline);
const h            = buildHandlers(unified);

wsServer.wireOrchestrator(orchestrator);

// In-memory: pipeline olaylarını doğrudan bağla
// Pg modu: migrate tamamlandıktan sonra PgSubscriber üzerinden cross-process fan-out
if (pgWireCallback) {
  pgWireCallback(wsServer);
} else {
  wsServer.wireEventPipeline();
}

// ── Feed katmanı ──────────────────────────────────────────────────────────────

const registry    = new PlayerRegistry();
const srAdapter   = new SportradarAdapter(registry);
const optaAdapter = new OptaAdapter(registry);
const webhook     = new WebhookReceiver(unified.pipeline as any);
webhook.register(srAdapter);
webhook.register(optaAdapter);

// ── Route Tanımları ───────────────────────────────────────────────────────────

router.get ('/',        ({ res }) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(UI_HTML);
});
router.get('/health', ({ res }) => {
  const mem = process.memoryUsage();
  json(res, 200, {
    status:    'ok',
    mode:      DB_URL ? 'postgres' : 'memory',
    uptime:    Math.floor(process.uptime()),
    memory: {
      heapUsedMb:  Math.round(mem.heapUsed  / 1_048_576),
      heapTotalMb: Math.round(mem.heapTotal / 1_048_576),
      rssMb:       Math.round(mem.rss       / 1_048_576),
    },
    wsConnections: wsServer.getConnectionCount(),
    activeMatches: orchestrator.listActive().length,
    timestamp:     new Date().toISOString(),
  });
});

router.get('/ready', async ({ res }) => {
  if (!pgPoolRef) { json(res, 200, { ready: true, mode: 'memory' }); return; }
  try {
    await pgPoolRef.query('SELECT 1');
    json(res, 200, { ready: true, mode: 'postgres' });
  } catch (e: unknown) {
    json(res, 503, { ready: false, error: (e as Error).message });
  }
});
router.get ('/players',                h.listPlayers);
router.get ('/market',                 h.marketAll);
router.get ('/market/:playerId',       h.marketPlayer);
router.post('/users',                  h.createUser);          // token döner
router.post('/auth/login',             h.login);               // var olan kullanıcıya token
router.get ('/wallet/:userId',         requireAuth(h.getWallet));
router.get ('/wallet/:userId/history', requireAuth(h.walletHistory));
router.get ('/squad/:userId',          requireAuth(h.getSquad));
router.get ('/squad/:userId/value',   requireAuth(h.getSquadValue));
router.post('/transfer/buy',           requireAuth(h.buyPlayer));
router.post('/transfer/sell',          requireAuth(h.sellPlayer));
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

router.get('/metrics', ({ res }) => {
  const body = metrics.toPrometheus({
    ws_connections_active: wsServer.getConnectionCount(),
    active_matches:        orchestrator.listActive().length,
  });
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
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

// ── Admin API ────────────────────────────────────────────────────────────────
//
// Tüm /admin/* rotaları X-Admin-Secret header'ı gerektirir.
// Üretimde ADMIN_SECRET env değişkenini güvenli bir değerle set edin.

function adminOnly(handler: import('./HttpRouter').RouteHandler): import('./HttpRouter').RouteHandler {
  return (ctx) => {
    if (ctx.req.headers['x-admin-secret'] !== ADMIN_SECRET) {
      json(ctx.res, 401, { error: 'Admin yetkisi gerekli (X-Admin-Secret)' });
      return Promise.resolve();
    }
    return Promise.resolve(handler(ctx));
  };
}

router.get('/admin/stats', adminOnly(async ({ res }) => {
  const mem = process.memoryUsage();
  json(res, 200, {
    uptime:        Math.floor(process.uptime()),
    mode:          DB_URL ? 'postgres' : 'memory',
    wsConnections: wsServer.getConnectionCount(),
    activeMatches: orchestrator.listActive(),
    metrics: {
      requests:    metrics.get('http_requests_total'),
      errors:      metrics.get('http_errors_total'),
      rateLimited: metrics.get('http_ratelimited_total'),
    },
    memory: {
      heapUsedMb:  Math.round(mem.heapUsed  / 1_048_576),
      rssMb:       Math.round(mem.rss       / 1_048_576),
    },
    timestamp: new Date().toISOString(),
  });
}));

router.get('/admin/users', adminOnly(async ({ res, query }) => {
  const limit  = Math.min(Number(query['limit']  ?? 50), 200);
  const offset = Math.max(Number(query['offset'] ?? 0),  0);
  const all    = await unified.wallet.getLeaderboard();
  json(res, 200, {
    users:   all.slice(offset, offset + limit),
    total:   all.length,
    limit,
    offset,
    hasMore: offset + limit < all.length,
  });
}));

router.post('/admin/match/force', adminOnly(({ res, body }) => {
  const { scenario = 'random', speed = 3 } = (body as any) ?? {};
  try {
    const matchId = orchestrator.startSimulation(scenario, Number(speed));
    json(res, 202, { matchId, scenario, speed: Number(speed), wsChannel: `match:${matchId}` });
  } catch (e: unknown) {
    json(res, 409, { error: (e as Error).message });
  }
}));

router.delete('/admin/match/:matchId', adminOnly(({ res, params }) => {
  const stopped = orchestrator.stopMatch(params.matchId);
  json(res, stopped ? 200 : 404, stopped
    ? { message: 'Maç durduruldu', matchId: params.matchId }
    : { error: 'Maç bulunamadı' },
  );
}));

router.post('/admin/user/:userId/credit', adminOnly(async ({ res, params, body }) => {
  const { amount, reason = 'admin_credit' } = (body as any) ?? {};
  if (typeof amount !== 'number' || amount === 0) {
    json(res, 400, { error: 'amount (number, sıfır dışı) zorunlu' }); return;
  }
  try {
    const type = amount > 0 ? 'PERFORMANCE_EARNINGS' : 'WITHDRAWAL';
    const tx   = await unified.wallet.credit(
      params.userId, amount, type as any,
      `admin:${reason}:${Date.now()}`, randomUUID(),
    );
    json(res, 200, { userId: params.userId, amount, tx });
  } catch (e: unknown) {
    json(res, 422, { error: (e as Error).message });
  }
}));

router.post('/admin/loadtest', adminOnly(async ({ res, body }) => {
  const { users = 10, durationMs = 5_000 } = (body as any) ?? {};
  if (users > 200)      { json(res, 400, { error: 'users maks 200' }); return; }
  if (durationMs > 30_000) { json(res, 400, { error: 'durationMs maks 30000' }); return; }
  try {
    const result = await runLoadTest({ users: Number(users), durationMs: Number(durationMs), host: '127.0.0.1', port: PORT });
    json(res, 200, result);
  } catch (e: unknown) {
    json(res, 500, { error: (e as Error).message });
  }
}));

// ── HTTP + WebSocket Sunucusu ─────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip       = getClientIp(req);
  const isAuth   = req.url?.startsWith('/auth') || req.url?.startsWith('/users');
  const rl       = isAuth ? authRl : apiRl;
  const { ok, remaining, retryAfterMs } = rl.allow(ip);

  if (!ok) {
    metrics.inc('http_ratelimited_total');
    res.writeHead(429, {
      'Content-Type':        'application/json',
      'X-RateLimit-Limit':   String(rl.limit),
      'X-RateLimit-Remaining': '0',
      'Retry-After':         String(Math.ceil(retryAfterMs / 1000)),
    });
    res.end(JSON.stringify({ error: 'Çok fazla istek — lütfen bekleyin', retryAfterMs }));
    return;
  }
  res.setHeader('X-RateLimit-Remaining', String(remaining));

  // ── Metrics + routing ─────────────────────────────────────────────────────
  metrics.inc('http_requests_total');

  router.handle(req, res).catch(err => {
    metrics.inc('http_errors_total');
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
  const MATCH_SPEED = 3;
  const BREAK_MS    = 15_000;
  let   backoff     = 1_000;   // hata sonrası yeniden başlama gecikmesi

  while (!shuttingDown) {
    try {
      const matchId = orchestrator.startSimulation('random', MATCH_SPEED);
      console.log(`[AutoMatch] Maç başladı: ${matchId}`);
      backoff = 1_000; // başarılı start → backoff sıfırla

      await new Promise<void>(resolve => {
        const onFull = ({ matchState }: any) => {
          if (matchState?.matchId !== matchId) return;
          orchestrator.off('match_aborted', onAbort);
          resolve();
        };
        const onAbort = ({ matchId: id }: any) => {
          if (id !== matchId) return;
          orchestrator.off('match_full_time', onFull);
          resolve();
        };
        orchestrator.once('match_full_time', onFull);
        orchestrator.once('match_aborted',   onAbort);
      });

      if (shuttingDown) break;

      console.log(`[AutoMatch] Maç bitti: ${matchId} — ${BREAK_MS / 1000}sn ara`);
      orchestrator.announceUpcoming('random', BREAK_MS);
      await sleep(BREAK_MS);

    } catch (err) {
      console.error(`[AutoMatch] Hata — ${backoff / 1000}sn sonra yeniden başlıyor:`, err);
      if (!shuttingDown) {
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000); // exponential backoff, maks 30sn
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getClientIp(req: import('http').IncomingMessage): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return (req.socket as any)?.remoteAddress ?? 'unknown';
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[Shutdown] ${signal} — servis kapatılıyor...`);

  // Yeni HTTP bağlantısı alma
  server.close();

  // Aktif maçları iptal et (WS istemcilerine MATCH_STATUS:ABORTED gönderilir)
  for (const m of orchestrator.listActive()) {
    orchestrator.stopMatch(m.matchId);
  }

  // WS bağlantılarını kapat
  wsServer.close();

  // Rate limiter zamanlayıcılarını kapat
  apiRl.destroy();
  authRl.destroy();

  // Pg bağlantılarını kapat
  await Promise.allSettled([
    pgSubRef?.stop(),
    pgPoolRef?.end(),
  ]);

  console.log('[Shutdown] Temizlik tamamlandı.');
  process.exit(0);
}

// 5sn içinde temizlik tamamlanmazsa zorla çık
const forceExit = () => setTimeout(() => { console.error('[Shutdown] Zaman aşımı — zorla çıkılıyor.'); process.exit(1); }, 5_000);

process.on('SIGTERM', () => { forceExit().unref(); gracefulShutdown('SIGTERM').catch(() => process.exit(1)); });
process.on('SIGINT',  () => { forceExit().unref(); gracefulShutdown('SIGINT').catch(() => process.exit(1)); });

// Yakalanmayan hatalar — loglayıp graceful shutdown dene
process.on('uncaughtException', (err, origin) => {
  console.error(`[Fatal] ${origin}:`, err);
  gracefulShutdown('uncaughtException').catch(() => process.exit(1));
});
process.on('unhandledRejection', (reason) => {
  // Çıkış yapmadan sadece logla — birçok promise hatası kurtarılabilir
  console.error('[Warning] UnhandledRejection:', reason);
});

export { server, wsServer, unified };
