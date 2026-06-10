import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool, parseDatabaseUrl } from '../PgPool';
import { PgWalletEngine }           from '../PgWalletEngine';
import { PgSquadManager }           from '../PgSquadManager';
import { PgMarketEngine }           from '../PgMarketEngine';
import { PgExchangeEngine }         from '../PgExchangeEngine';
import { migrate }                  from '../migrate';
import { InsufficientFundsError }   from '../../wallet/errors';
import { Player }                   from '../../wallet/types';
import { WORLD_CUP_PLAYERS }        from '../../mock/MatchSimulator';

// ── Test ortamı ───────────────────────────────────────────────────────────────
//
// DATABASE_URL yoksa tüm testler atlanır:
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/wc2026_test npm test

const DB_URL   = process.env.DATABASE_URL;
const skipMsg  = DB_URL ? undefined : 'DATABASE_URL tanımlı değil — atlandı';
const skip     = { skip: skipMsg };

let pool:    PgPool;
let wallet:  PgWalletEngine;
let squad:   PgSquadManager;
let market:  PgMarketEngine;
let exchange: PgExchangeEngine;

const MBAPPE    = WORLD_CUP_PLAYERS.find(p => p.id === 'mbappe')!    as Player;
const BELLINGHAM = WORLD_CUP_PLAYERS.find(p => p.id === 'bellingham')! as Player;

// ── Kurulum ───────────────────────────────────────────────────────────────────

if (DB_URL) {
  before(async () => {
    pool     = new PgPool(parseDatabaseUrl(DB_URL), 5);
    wallet   = new PgWalletEngine(pool);
    squad    = new PgSquadManager(pool);
    market   = new PgMarketEngine(pool);
    exchange = new PgExchangeEngine(wallet, squad, market);

    await migrate(pool);

    // Test temizliği — önceki test verilerini sil
    await pool.query('TRUNCATE squad_members, squad_versions, transactions, wallets, demand_events, perf_events, price_history, market_prices, players CASCADE');
  });

  after(async () => {
    await pool?.end();
  });
}

// ── PgWalletEngine ────────────────────────────────────────────────────────────

describe('PgWalletEngine', skip, () => {
  it('createWallet → getWallet tutarlı snapshot döner', async () => {
    await wallet.createWallet('w-user-1', 5000);
    const snap = await wallet.getWallet('w-user-1');
    assert.equal(snap.userId,   'w-user-1');
    assert.equal(snap.balance,  5000);
    assert.equal(snap.reserved, 0);
    assert.equal(snap.version,  0);
  });

  it('getAvailable = balance - reserved', async () => {
    await wallet.createWallet('w-user-2', 1000);
    assert.equal(await wallet.getAvailable('w-user-2'), 1000);
  });

  it('reserveFunds → reserved artar, available düşer', async () => {
    await wallet.createWallet('w-user-3', 1000);
    const tx = await wallet.reserveFunds('w-user-3', 600, 'ik-r1');

    assert.equal(tx.status, 'PENDING');
    assert.equal(tx.amount, 600);
    assert.equal(await wallet.getAvailable('w-user-3'), 400);
  });

  it('commitReservation → balance düşer, reserved sıfırlanır', async () => {
    await wallet.createWallet('w-user-4', 2000);
    const tx      = await wallet.reserveFunds('w-user-4', 800, 'ik-c1');
    const committed = await wallet.commitReservation(tx.txId);

    assert.equal(committed.status, 'COMMITTED');
    const snap = await wallet.getWallet('w-user-4');
    assert.equal(snap.balance,  1200);
    assert.equal(snap.reserved, 0);
  });

  it('rollbackReservation → reserved serbest kalır, idempotency temizlenir', async () => {
    await wallet.createWallet('w-user-5', 1000);
    const tx = await wallet.reserveFunds('w-user-5', 500, 'ik-rb1');
    await wallet.rollbackReservation(tx.txId);

    assert.equal(await wallet.getAvailable('w-user-5'), 1000);

    // Aynı key ile yeniden denenebilir
    const tx2 = await wallet.reserveFunds('w-user-5', 300, 'ik-rb1');
    assert.equal(tx2.status, 'PENDING');
    assert.equal(await wallet.getAvailable('w-user-5'), 700);
  });

  it('credit → bakiye anında artar', async () => {
    await wallet.createWallet('w-user-6', 500);
    const tx = await wallet.credit('w-user-6', 200, 'PERFORMANCE_EARNINGS', 'ik-cr1');

    assert.equal(tx.status, 'COMMITTED');
    assert.equal(await wallet.getAvailable('w-user-6'), 700);
  });

  it('idempotency — aynı key ile ikinci çağrı ilk sonucu döner', async () => {
    await wallet.createWallet('w-user-7', 2000);
    const tx1 = await wallet.reserveFunds('w-user-7', 500, 'ik-idem1');
    const tx2 = await wallet.reserveFunds('w-user-7', 500, 'ik-idem1');

    assert.equal(tx1.txId,   tx2.txId);
    assert.equal(await wallet.getAvailable('w-user-7'), 1500); // yalnızca bir kez rezerve
  });

  it('InsufficientFundsError — bakiye yetersizse hata fırlatır', async () => {
    await wallet.createWallet('w-user-8', 300);
    await assert.rejects(
      () => wallet.reserveFunds('w-user-8', 500, 'ik-insuf1'),
      InsufficientFundsError,
    );
    assert.equal(await wallet.getAvailable('w-user-8'), 300); // değişmemiş
  });

  // ── Çift harcama önleme: iki eşzamanlı rezervasyon ──────────────────────────
  it('çift harcama önleme — iki eşzamanlı rezervasyon (SELECT FOR UPDATE)', async () => {
    await wallet.createWallet('w-user-9', 1000);

    const results = await Promise.allSettled([
      wallet.reserveFunds('w-user-9', 700, 'ik-ds1'),
      wallet.reserveFunds('w-user-9', 700, 'ik-ds2'),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected  = results.filter(r => r.status === 'rejected');
    assert.equal(fulfilled.length, 1, 'Yalnızca biri başarılı olmalı');
    assert.equal(rejected.length,  1, 'Biri InsufficientFundsError almalı');
    assert.equal(await wallet.getAvailable('w-user-9'), 300);
  });

  it('getHistory → kullanıcının işlemlerini döner', async () => {
    await wallet.createWallet('w-user-10', 5000);
    await wallet.reserveFunds('w-user-10', 1000, 'ik-h1');
    await wallet.credit('w-user-10', 200, 'PERFORMANCE_EARNINGS', 'ik-h2');

    const hist = await wallet.getHistory('w-user-10');
    assert.ok(hist.length >= 2);
    assert.ok(hist.every(t => t.userId === 'w-user-10'));
  });

  it('getByIdempotencyKey → var olan işlemi bulur', async () => {
    await wallet.createWallet('w-user-11', 1000);
    await wallet.credit('w-user-11', 100, 'DEPOSIT', 'ik-gik1');
    const found = await wallet.getByIdempotencyKey('ik-gik1');
    assert.ok(found);
    assert.equal(found!.amount, 100);
  });
});

// ── PgSquadManager ────────────────────────────────────────────────────────────

describe('PgSquadManager', skip, () => {
  it('createSquad → addPlayer → getSquad tutarlı', async () => {
    await wallet.createWallet('sq-user-1', 0);
    await squad.createSquad('sq-user-1');

    await squad.addPlayer('sq-user-1', MBAPPE, 'starting');
    const snap = await squad.getSquad('sq-user-1');

    assert.equal(snap.entries.length, 1);
    assert.equal(snap.entries[0].player.id, 'mbappe');
    assert.equal(snap.entries[0].slot,      'starting');
  });

  it('removePlayer → oyuncu kadroda kalmaz', async () => {
    await wallet.createWallet('sq-user-2', 0);
    await squad.createSquad('sq-user-2');
    await squad.addPlayer('sq-user-2', BELLINGHAM, 'starting');

    const removed = await squad.removePlayer('sq-user-2', 'bellingham');
    assert.equal(removed.player.id, 'bellingham');

    const snap = await squad.getSquad('sq-user-2');
    assert.equal(snap.entries.length, 0);
  });

  it('SquadCapacityError — başlangıç kadrosu 11 ile sınırlı', async () => {
    await wallet.createWallet('sq-user-3', 0);
    await squad.createSquad('sq-user-3');

    for (const p of WORLD_CUP_PLAYERS.slice(0, 11)) {
      await squad.addPlayer('sq-user-3', p, 'starting');
    }

    const extra = WORLD_CUP_PLAYERS[11];
    await assert.rejects(
      () => squad.addPlayer('sq-user-3', extra, 'starting'),
      /SquadCapacityError|kapasite|dolu/i,
    );
  });

  it('hasPlayer + slotCount + totalCount doğru döner', async () => {
    await wallet.createWallet('sq-user-4', 0);
    await squad.createSquad('sq-user-4');
    await squad.addPlayer('sq-user-4', MBAPPE, 'starting');
    await squad.addPlayer('sq-user-4', BELLINGHAM, 'bench');

    assert.ok(await squad.hasPlayer('sq-user-4', 'mbappe'));
    assert.ok(!await squad.hasPlayer('sq-user-4', 'haaland'));
    assert.equal(await squad.slotCount('sq-user-4', 'starting'), 1);
    assert.equal(await squad.slotCount('sq-user-4', 'bench'),    1);
    assert.equal(await squad.totalCount('sq-user-4'), 2);
  });
});

// ── PgMarketEngine ────────────────────────────────────────────────────────────

describe('PgMarketEngine', skip, () => {
  before(async () => {
    if (!DB_URL) return;
    await market.registerPlayerFull('mbappe-mk',     'Mbappé',     'FWD', 3000);
    await market.registerPlayerFull('bellingham-mk', 'Bellingham', 'MID', 2000);
  });

  it('getPrice kayıtlı oyuncunun fiyatını döner', async () => {
    const price = await market.getPrice('mbappe-mk');
    assert.equal(price, 3000);
  });

  it('applyPerformance — gol fiyatı artırır', async () => {
    const before = await market.getPrice('mbappe-mk');
    const after  = await market.applyPerformance('mbappe-mk', 200, 'GOAL');
    assert.ok(after > before, `${after} > ${before} olmalıydı`);
  });

  it('recordBuy alım baskısı yaratır', async () => {
    const before = await market.getPrice('bellingham-mk');
    for (let i = 0; i < 5; i++) await market.recordBuy('bellingham-mk');
    const after = await market.getPrice('bellingham-mk');
    assert.ok(after >= before, 'Alım baskısı fiyatı düşürmemeli');
  });

  it('getPriceHistory fiyat değişimlerini kaydeder', async () => {
    const hist = await market.getPriceHistory('mbappe-mk');
    assert.ok(hist.length >= 1);
    assert.ok(hist.every(h => h.price > 0 && h.reason));
  });

  it('getSnapshot trend hesaplar', async () => {
    const snap = await market.getSnapshot('mbappe-mk');
    assert.ok(['UP','DOWN','STABLE'].includes(snap.trend));
    assert.ok(snap.currentPrice > 0);
  });
});

// ── PgExchangeEngine — uçtan uca ─────────────────────────────────────────────

describe('PgExchangeEngine — uçtan uca', skip, () => {
  it('satın al → sat döngüsü tutarlı', async () => {
    await wallet.createWallet('ex-user-1', 10_000);
    await squad.createSquad('ex-user-1');
    await market.registerPlayerFull('haaland-ex', 'Haaland', 'FWD', 2800);

    const haaland: Player = {
      id: 'haaland-ex', name: 'Haaland',
      position: 'FWD', marketPrice: 2800, performanceScore: 0,
    };

    // Satın al
    const buyResult = await exchange.buyPlayer('ex-user-1', haaland, 'starting', 'ik-ex-buy');
    assert.equal(buyResult.transaction.status, 'COMMITTED');
    assert.ok(buyResult.available < 10_000);

    // Sat
    const sellResult = await exchange.sellPlayer('ex-user-1', 'haaland-ex', 'ik-ex-sell');
    assert.equal(sellResult.transaction.status, 'COMMITTED');
    assert.ok(sellResult.available > buyResult.available);
  });

  it('yetersiz bakiyle satın alma başarısız', async () => {
    await wallet.createWallet('ex-user-2', 100);
    await squad.createSquad('ex-user-2');
    await market.registerPlayerFull('vinicius-ex', 'Vinicius', 'FWD', 2500);

    const vinicius: Player = {
      id: 'vinicius-ex', name: 'Vinicius',
      position: 'FWD', marketPrice: 2500, performanceScore: 0,
    };

    await assert.rejects(
      () => exchange.buyPlayer('ex-user-2', vinicius, 'starting', 'ik-ex-fail'),
      InsufficientFundsError,
    );
    assert.equal(await wallet.getAvailable('ex-user-2'), 100); // değişmemiş
  });

  it('idempotent satın alma — aynı key ile ikinci çağrı aynı sonucu döner', async () => {
    await wallet.createWallet('ex-user-3', 10_000);
    await squad.createSquad('ex-user-3');
    await market.registerPlayerFull('pedri-ex', 'Pedri', 'MID', 1800);

    const pedri: Player = {
      id: 'pedri-ex', name: 'Pedri',
      position: 'MID', marketPrice: 1800, performanceScore: 0,
    };

    const r1 = await exchange.buyPlayer('ex-user-3', pedri, 'starting', 'ik-idem-buy');
    const r2 = await exchange.buyPlayer('ex-user-3', pedri, 'starting', 'ik-idem-buy');
    assert.equal(r1.transaction.txId, r2.transaction.txId);
  });
});
