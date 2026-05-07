import { createServer } from 'http';
import { HttpRouter }    from './HttpRouter';
import { buildHandlers } from './handlers';
import { createGameContext, registerPlayers } from '../context/GameContext';
import { WsServer }      from '../ws/WsServer';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';

const PORT = Number(process.env.PORT ?? 3000);

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────

const ctx      = createGameContext();
const router   = new HttpRouter();
const wsServer = new WsServer(ctx);
const h        = buildHandlers(ctx);

// Tüm WC2026 oyuncularını piyasaya kaydet
registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));

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
  const { json } = require('./HttpRouter');
  json(res, 200, {
    connections: wsServer.getConnectionCount(),
    timestamp:   new Date().toISOString(),
  });
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
