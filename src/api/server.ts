import { createServer } from 'http';
import { HttpRouter }    from './HttpRouter';
import { buildHandlers } from './handlers';
import { createGameContext, registerPlayers, createPgContext, registerPgPlayers, bootstrapPgUser } from '../context/GameContext';
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
import { migrate } from '../db/migrate';

const PORT   = Number(process.env.PORT ?? 3000);
const DB_URL = process.env.DATABASE_URL;

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────

// In-memory context (varsayılan — her zaman hazır)
const ctx      = createGameContext();
const router   = new HttpRouter();
const wsServer = new WsServer(ctx);
const h        = buildHandlers(ctx);

// Tüm WC2026 oyuncularını piyasaya kaydet
registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));

// PostgreSQL'e arka planda bağlan (DATABASE_URL varsa)
if (DB_URL) {
  const pool = new PgPool(parseDatabaseUrl(DB_URL), 10);
  migrate(pool)
    .then(() => registerPgPlayers(
      createPgContext(pool),
      WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })),
    ))
    .then(() => console.log('🐘  PostgreSQL hazır — kalıcı depolama aktif'))
    .catch(err => console.warn('⚠️  PostgreSQL başlatma hatası (in-memory modda devam):', err.message));
}

// ── Feed katmanı kurulumu ─────────────────────────────────────────────────────

const registry = new PlayerRegistry();
const srAdapter   = new SportradarAdapter(registry);
const optaAdapter = new OptaAdapter(registry);
const webhook     = new WebhookReceiver(ctx.pipeline);
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

// GET /ws/stats — bağlı istemci sayısı
router.get('/ws/stats', ({ res }) => {
  json(res, 200, {
    connections: wsServer.getConnectionCount(),
    timestamp:   new Date().toISOString(),
  });
});

// POST /feed/webhook/:provider?matchId=xxx — Sportradar/Opta webhook alıcısı
router.post('/feed/webhook/:provider', async ({ req, res, params, query }) => {
  const provider = params.provider.toUpperCase() as ProviderId;
  const matchId  = query['matchId'] ?? query['match_id'] ?? 'unknown';
  await webhook.handle(req, res, provider, matchId);
});

// POST /feed/replay/:scenario — dev modunda maç simülasyonu başlat
router.post('/feed/replay/:scenario', async ({ res, params }) => {
  const scenario = params.scenario as 'final' | 'random';
  const replay   = new FeedReplay(ctx.pipeline);
  replay.loadScenario(scenario);
  // Arkaplanda çalıştır, anında yanıt ver
  replay.start(50).catch(console.error);
  json(res, 202, {
    message:  `Replay başlatıldı: ${scenario}`,
    note:     'Eventler WS üzerinden yayınlanacak',
  });
});

// GET /feed/players — kayıtlı player mapping'leri
router.get('/feed/players', ({ res }) => {
  json(res, 200, { players: registry.getAll() });
});

// ── HTTP + WebSocket Sunucusu (aynı port) ─────────────────────────────────────

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

// WebSocket'i HTTP sunucusuna bağla — aynı port paylaşılır
wsServer.attach(server);

server.listen(PORT, () => {
  console.log('\n⚽  World Cup 2026: Live Stock & Manager');
  console.log(`🚀  REST API:  http://localhost:${PORT}`);
  console.log(`🔌  WebSocket: ws://localhost:${PORT}`);
  console.log(`📊  ${WORLD_CUP_PLAYERS.length} oyuncu piyasaya yüklendi\n`);
  console.log('REST Endpoint\'ler:');
  console.log('  GET  /players              — Piyasadaki oyuncular');
  console.log('  GET  /market               — Anlık fiyat tablosu');
  console.log('  POST /users                — Kullanıcı oluştur');
  console.log('  POST /transfer/buy|sell    — Transfer');
  console.log('  POST /match/event          — Canlı maç eventi');
  console.log('  GET  /leaderboard          — Sıralama\n');
  console.log('WebSocket Kanalları:');
  console.log('  market              — Tüm fiyat güncellemeleri');
  console.log('  match:<matchId>     — Maç eventleri');
  console.log('  wallet:<userId>     — Kişisel cüzdan bildirimleri\n');
  console.log('Bağlantı örneği:');
  console.log(`  ws://localhost:${PORT}  →  { type: "SUBSCRIBE", channel: "market" }\n`);
});

export { server, wsServer, ctx };
