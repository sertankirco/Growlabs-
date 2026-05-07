import { createServer } from 'http';
import { HttpRouter }   from './HttpRouter';
import { buildHandlers } from './handlers';
import { createGameContext, registerPlayers } from '../context/GameContext';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';

const PORT = Number(process.env.PORT ?? 3000);

// ── Uygulama Başlatma ─────────────────────────────────────────────────────────

const ctx     = createGameContext();
const router  = new HttpRouter();
const h       = buildHandlers(ctx);

// Tüm WC2026 oyuncularını piyasaya kaydet
registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));

// ── Route Tanımları ───────────────────────────────────────────────────────────

router.get ('/',                    h.health);
router.get ('/health',              h.health);

// Oyuncular
router.get ('/players',             h.listPlayers);

// Piyasa
router.get ('/market',              h.marketAll);
router.get ('/market/:playerId',    h.marketPlayer);

// Kullanıcılar
router.post('/users',               h.createUser);
router.get ('/wallet/:userId',      h.getWallet);
router.get ('/wallet/:userId/history', h.walletHistory);
router.get ('/squad/:userId',       h.getSquad);

// Transferler
router.post('/transfer/buy',        h.buyPlayer);
router.post('/transfer/sell',       h.sellPlayer);

// Maç yönetimi
router.post('/match/start',         h.startMatch);
router.post('/match/event',         h.pushMatchEvent);

// Liderlik tablosu
router.get ('/leaderboard',         h.leaderboard);

// ── HTTP Sunucusu ─────────────────────────────────────────────────────────────

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
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

server.listen(PORT, () => {
  console.log(`\n⚽  World Cup 2026: Live Stock & Manager`);
  console.log(`🚀  API Sunucusu: http://localhost:${PORT}`);
  console.log(`📊  ${WORLD_CUP_PLAYERS.length} oyuncu piyasaya yüklendi\n`);
  console.log('Endpoint\'ler:');
  console.log('  GET  /players          — Piyasadaki tüm oyuncular');
  console.log('  GET  /market           — Anlık fiyat tablosu');
  console.log('  POST /users            — Kullanıcı oluştur');
  console.log('  GET  /wallet/:userId   — Cüzdan durumu');
  console.log('  POST /transfer/buy     — Oyuncu satın al');
  console.log('  POST /transfer/sell    — Oyuncu sat');
  console.log('  POST /match/event      — Maç eventi gönder');
  console.log('  GET  /leaderboard      — Liderlik tablosu\n');
});

export { server, ctx };
