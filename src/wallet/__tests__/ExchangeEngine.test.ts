import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WalletEngine }   from '../WalletEngine';
import { SquadManager }   from '../SquadManager';
import { ExchangeEngine } from '../ExchangeEngine';
import { Player }         from '../types';
import {
  InsufficientFundsError,
  PlayerAlreadyInSquadError,
  PlayerNotInSquadError,
} from '../errors';

// ── Fikstür ───────────────────────────────────────────────────────────────────

function makePlayer(id: string, position: Player['position'] = 'MID'): Player {
  return { id, name: `Oyuncu ${id}`, position, marketPrice: 0, performanceScore: 0 };
}

let wallet:   WalletEngine;
let squad:    SquadManager;
let exchange: ExchangeEngine;

function setup(initialBalance = 5000) {
  wallet   = new WalletEngine();
  squad    = new SquadManager();
  exchange = new ExchangeEngine(wallet, squad);

  wallet.createWallet('u1', initialBalance);
  squad.createSquad('u1');

  exchange.setPrice('p1', 1000);
  exchange.setPrice('p2',  800);
  exchange.setPrice('p3',  600);
}

// ── Satın alma ────────────────────────────────────────────────────────────────

describe('ExchangeEngine — satın alma', () => {
  beforeEach(() => setup());

  it('başarılı satın alma sonrası bakiye düşer', async () => {
    const { available } = await exchange.buyPlayer('u1', makePlayer('p1'), 'starting');
    assert.equal(available, 4000);
  });

  it('oyuncu kadroya eklenir', async () => {
    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting');
    assert.ok(squad.hasPlayer('u1', 'p1'));
  });

  it('bakiye yetersizse satın alma reddedilir, kadro ve bakiye değişmez', async () => {
    setup(500);
    await assert.rejects(
      () => exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-buy'),
      InsufficientFundsError,
    );
    assert.ok(!squad.hasPlayer('u1', 'p1'));
    assert.equal(wallet.getAvailable('u1'), 500);
  });

  it('hata durumunda rezervasyon geri alınır (available tam geri gelir)', async () => {
    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-first');
    await assert.rejects(
      () => exchange.buyPlayer('u1', makePlayer('p1'), 'bench', 'ik-second'),
      PlayerAlreadyInSquadError,
    );
    assert.equal(wallet.getAvailable('u1'), 4000);
    assert.equal(wallet.getWallet('u1').reserved, 0);
  });

  it('idempotent satın alma — aynı key iki kez çağrılırsa tek işlem yapılır', async () => {
    const p1 = makePlayer('p1');
    await exchange.buyPlayer('u1', p1, 'starting', 'ik-buy-p1');
    await exchange.buyPlayer('u1', p1, 'starting', 'ik-buy-p1');
    assert.equal(wallet.getAvailable('u1'), 4000);
  });
});

// ── Satış ─────────────────────────────────────────────────────────────────────

describe('ExchangeEngine — satış', () => {
  beforeEach(() => setup());

  it('satış sonrası bakiye anında artar', async () => {
    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-buy');
    const { available } = await exchange.sellPlayer('u1', 'p1', 'ik-sell');
    assert.equal(available, 5000);
  });

  it('satış sonrası oyuncu kadroda kalmaz', async () => {
    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-buy');
    await exchange.sellPlayer('u1', 'p1', 'ik-sell');
    assert.ok(!squad.hasPlayer('u1', 'p1'));
  });

  it('kadroda olmayan oyuncu satılamaz, bakiye korunur', async () => {
    await assert.rejects(
      () => exchange.sellPlayer('u1', 'p-ghost', 'ik-sell'),
      PlayerNotInSquadError,
    );
    assert.equal(wallet.getAvailable('u1'), 5000);
  });

  it('idempotent satış — aynı key ile iki kez satış tek sefer uygulanır', async () => {
    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-buy');
    await exchange.sellPlayer('u1', 'p1', 'ik-sell');
    const { available } = await exchange.sellPlayer('u1', 'p1', 'ik-sell');
    assert.equal(available, 5000);
  });
});

// ── Çift harcama senaryoları ──────────────────────────────────────────────────

describe('ExchangeEngine — çift harcama önleme', () => {
  it('bakiyeyi aşan iki eşzamanlı satın alma — yalnızca biri kabul edilir', async () => {
    setup(1500); // p1=1000 + p2=800 = 1800 > 1500
    const results = await Promise.allSettled([
      exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-p1'),
      exchange.buyPlayer('u1', makePlayer('p2'), 'bench',    'ik-p2'),
    ]);
    const ok   = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    assert.equal(ok, 1);
    assert.equal(fail, 1);
    assert.ok(wallet.getAvailable('u1') >= 0);
    assert.equal(wallet.getWallet('u1').reserved, 0);
  });

  it('10 eşzamanlı alım — bakiye tutarlılığı korunur', async () => {
    setup(2500);
    exchange.setPrice('px', 500);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        exchange.buyPlayer('u1', makePlayer('px'), 'starting', `ik-${i}`),
      ),
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    assert.ok(ok <= 5); // en fazla floor(2500/500)=5
    assert.ok(wallet.getAvailable('u1') >= 0);
    assert.equal(wallet.getWallet('u1').reserved, 0);
  });

  it('paralel satın alma + satış — bakiye asla negatife düşmez', async () => {
    setup(3000);
    await exchange.buyPlayer('u1', makePlayer('p2'), 'starting', 'ik-init');
    await Promise.allSettled([
      exchange.buyPlayer('u1', makePlayer('p1'), 'bench',    'ik-buy-p1'),
      exchange.sellPlayer('u1', 'p2',                        'ik-sell-p2'),
    ]);
    assert.ok(wallet.getAvailable('u1') >= 0);
    assert.equal(wallet.getWallet('u1').reserved, 0);
  });
});

// ── Performans kazancı ────────────────────────────────────────────────────────

describe('ExchangeEngine — performans kazancı', () => {
  beforeEach(() => setup());

  it('performans kazancı bakiyeyi artırır', async () => {
    await exchange.creditPerformance('u1', 'p1', 250, 'ik-perf');
    assert.equal(wallet.getAvailable('u1'), 5250);
  });

  it('idempotent performans kredisi — iki kez gönderilirse tek sefer uygulanır', async () => {
    await exchange.creditPerformance('u1', 'p1', 100, 'ik-perf-same');
    await exchange.creditPerformance('u1', 'p1', 100, 'ik-perf-same');
    assert.equal(wallet.getAvailable('u1'), 5100);
  });
});

// ── Uçtan uca transfer akışı ──────────────────────────────────────────────────

describe('ExchangeEngine — uçtan uca transfer akışı', () => {
  it('performans kazancıyla birden fazla transfer mümkündür', async () => {
    setup(1000);
    exchange.setPrice('p1', 1000);
    exchange.setPrice('p2',  500);

    await exchange.buyPlayer('u1', makePlayer('p1'), 'starting', 'ik-b1');
    assert.equal(wallet.getAvailable('u1'), 0);

    await exchange.creditPerformance('u1', 'p1', 600, 'ik-earn');
    assert.equal(wallet.getAvailable('u1'), 600);

    await exchange.buyPlayer('u1', makePlayer('p2'), 'bench', 'ik-b2');
    assert.equal(wallet.getAvailable('u1'), 100);

    await exchange.sellPlayer('u1', 'p1', 'ik-s1');
    assert.equal(wallet.getAvailable('u1'), 1100);
  });
});
