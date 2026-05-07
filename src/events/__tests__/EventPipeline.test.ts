import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'crypto';

import { createGameContext, bootstrapUser, registerPlayers, GameContext } from '../../context/GameContext';
import { WORLD_CUP_PLAYERS, buildFinalScenario } from '../../mock/MatchSimulator';
import { MatchEvent } from '../types';

// ── Fikstür ───────────────────────────────────────────────────────────────────

let ctx: GameContext;

function setup() {
  ctx = createGameContext();
  bootstrapUser(ctx, 'u1', 10_000);
  bootstrapUser(ctx, 'u2', 10_000);
  registerPlayers(
    ctx,
    WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })),
  );
}

function makeEvent(
  playerId: string,
  position: MatchEvent['position'],
  type: MatchEvent['type'],
  minute = 30,
  matchId = 'test-match',
): MatchEvent {
  return { eventId: randomUUID(), matchId, playerId, position, type, minute, timestamp: Date.now() };
}

// ── PerformanceCalculator ─────────────────────────────────────────────────────

describe('PerformanceCalculator — ödül tablosu', () => {
  it('forvet gol için 200 coin alır', () => {
    setup();
    const ev  = makeEvent('mbappe', 'FWD', 'GOAL');
    const res = ctx.pipeline['calculator'].calculate(ev);
    assert.equal(res.coins, 200);
  });

  it('kaleci temiz kale için 150 coin alır', () => {
    setup();
    const ev  = makeEvent('courtois', 'GK', 'CLEAN_SHEET');
    const res = ctx.pipeline['calculator'].calculate(ev);
    assert.equal(res.coins, 150);
  });

  it('kırmızı kart −100 coin cezası verir (tüm pozisyonlar)', () => {
    setup();
    for (const pos of ['GK', 'DEF', 'MID', 'FWD'] as const) {
      const ev  = makeEvent('test-p', pos, 'RED_CARD');
      const res = ctx.pipeline['calculator'].calculate(ev);
      assert.equal(res.coins, -100, `${pos} için kırmızı kart cezası yanlış`);
    }
  });

  it('forvet penaltı kaçırmada en yüksek ceza (−60)', () => {
    setup();
    const ev  = makeEvent('haaland', 'FWD', 'PENALTY_MISS');
    const res = ctx.pipeline['calculator'].calculate(ev);
    assert.equal(res.coins, -60);
  });

  it('forvet için temiz kale sıfır coin (teşvik yok)', () => {
    setup();
    const ev  = makeEvent('mbappe', 'FWD', 'CLEAN_SHEET');
    const res = ctx.pipeline['calculator'].calculate(ev);
    assert.equal(res.coins, 0);
  });
});

// ── MarketEngine ──────────────────────────────────────────────────────────────

describe('MarketEngine — dinamik fiyatlandırma', () => {
  it('pozitif performans fiyatı artırır', () => {
    setup();
    const before = ctx.market.getPrice('mbappe');
    ctx.market.applyPerformance('mbappe', 200, 'GOAL@18');
    const after  = ctx.market.getPrice('mbappe');
    assert.ok(after > before, `Fiyat artmalıydı: ${before} → ${after}`);
  });

  it('negatif performans fiyatı düşürür', () => {
    setup();
    const before = ctx.market.getPrice('militao');
    ctx.market.applyPerformance('militao', -100, 'RED_CARD@41');
    const after  = ctx.market.getPrice('militao');
    assert.ok(after < before, `Fiyat düşmeliydi: ${before} → ${after}`);
  });

  it('fiyat MIN_PRICE (50) altına düşemez', () => {
    setup();
    // 10 ardışık ağır ceza uygula
    for (let i = 0; i < 10; i++) {
      ctx.market.applyPerformance('courtois', -1000, 'AĞIR_CEZA');
    }
    assert.ok(ctx.market.getPrice('courtois') >= 50);
  });

  it('tek event maks ±%30 değişime neden olur', () => {
    setup();
    const before = ctx.market.getPrice('bellingham');
    ctx.market.applyPerformance('bellingham', 10_000, 'AŞIRI_GOL');
    const after  = ctx.market.getPrice('bellingham');
    const pct    = Math.abs((after - before) / before);
    assert.ok(pct <= 0.30 + 0.001, `Değişim %${(pct * 100).toFixed(1)} > %30`);
  });

  it('sürekli alım baskısı fiyatı ilk değerin üzerine taşır', () => {
    setup();
    const p1 = ctx.market.getPrice('vinicius');
    for (let i = 0; i < 10; i++) ctx.market.recordBuy('vinicius');
    assert.ok(ctx.market.getPrice('vinicius') > p1, 'Yoğun alım fiyatı artırmalı');
  });

  it('sürekli satım baskısı fiyatı ilk değerin altına çeker', () => {
    setup(); // fresh state — geçmiş alım yok
    const p1 = ctx.market.getPrice('vinicius');
    for (let i = 0; i < 10; i++) ctx.market.recordSell('vinicius');
    assert.ok(ctx.market.getPrice('vinicius') < p1, 'Yoğun satım fiyatı düşürmeli');
  });

  it('snapshot trend doğru döner', () => {
    setup();
    ctx.market.applyPerformance('haaland', 300, 'GOL');
    const snap = ctx.market.getSnapshot('haaland');
    assert.equal(snap.trend, 'UP');
  });
});

// ── EventPipeline — dispatch ──────────────────────────────────────────────────

describe('EventPipeline — dispatch', () => {
  it('gol eventi sahibi kullanıcı cüzdanını günceller', async () => {
    setup();
    await ctx.exchange.buyPlayer('u1', WORLD_CUP_PLAYERS.find(p => p.id === 'mbappe')!, 'starting', 'ik-buy');

    const before  = ctx.wallet.getAvailable('u1');
    const result  = await ctx.pipeline.dispatch(makeEvent('mbappe', 'FWD', 'GOAL'));

    const after   = ctx.wallet.getAvailable('u1');
    assert.equal(result.creditsApplied, 1);
    assert.equal(after - before, 200); // forvet golü = 200 coin
  });

  it('aynı oyuncuya sahip iki kullanıcı her ikisi de güncellenir', async () => {
    setup();
    const p = WORLD_CUP_PLAYERS.find(p => p.id === 'bellingham')!;
    await ctx.exchange.buyPlayer('u1', p, 'starting', 'ik-u1');
    await ctx.exchange.buyPlayer('u2', p, 'starting', 'ik-u2');

    const b1 = ctx.wallet.getAvailable('u1');
    const b2 = ctx.wallet.getAvailable('u2');

    await ctx.pipeline.dispatch(makeEvent('bellingham', 'MID', 'GOAL'));

    assert.equal(ctx.wallet.getAvailable('u1') - b1, 150); // MID GOL = 150
    assert.equal(ctx.wallet.getAvailable('u2') - b2, 150);
  });

  it('ceza eventi cüzdandan keser', async () => {
    setup();
    await ctx.exchange.buyPlayer('u1', WORLD_CUP_PLAYERS.find(p => p.id === 'de-bruyne')!, 'starting', 'ik-buy');
    const before = ctx.wallet.getAvailable('u1');
    await ctx.pipeline.dispatch(makeEvent('de-bruyne', 'MID', 'YELLOW_CARD'));
    assert.equal(ctx.wallet.getAvailable('u1') - before, -30);
  });

  it('oyuncuya sahip kullanıcı yoksa dispatch başarıyla tamamlanır', async () => {
    setup();
    const result = await ctx.pipeline.dispatch(makeEvent('saka', 'FWD', 'GOAL'));
    assert.equal(result.creditsApplied, 0);
    assert.ok(result.durationMs >= 0);
  });

  it('dispatch piyasa fiyatını günceller', async () => {
    setup();
    const before = ctx.market.getPrice('pedri');
    await ctx.pipeline.dispatch(makeEvent('pedri', 'MID', 'ASSIST'));
    const after  = ctx.market.getPrice('pedri');
    assert.ok(after !== before, 'Asist sonrası fiyat değişmeli');
  });

  it('idempotency: aynı event tekrar dispatch edilirse cüzdan iki kez güncellenmez', async () => {
    setup();
    const p   = WORLD_CUP_PLAYERS.find(p => p.id === 'osimhen')!;
    await ctx.exchange.buyPlayer('u1', p, 'starting', 'ik-buy-osimhen');
    const ev  = makeEvent('osimhen', 'FWD', 'GOAL');
    const before = ctx.wallet.getAvailable('u1');
    await ctx.pipeline.dispatch(ev);
    await ctx.pipeline.dispatch(ev); // aynı eventId
    assert.equal(ctx.wallet.getAvailable('u1') - before, 200); // tek sefer
  });
});

// ── Tam Dünya Kupası Finali Simülasyonu ───────────────────────────────────────

describe('MatchSimulator — final senaryosu uçtan uca', () => {
  it('final maçı tüm event\'leri tutarlı şekilde işler', async () => {
    setup();
    const scenario = buildFinalScenario();
    ctx.pipeline.startMatch(scenario.matchId, scenario.homeTeam, scenario.awayTeam);

    // u1 Mbappé ve Bellingham'a sahip
    const mbappe     = WORLD_CUP_PLAYERS.find(p => p.id === 'mbappe')!;
    const bellingham = WORLD_CUP_PLAYERS.find(p => p.id === 'bellingham')!;
    await ctx.exchange.buyPlayer('u1', mbappe,     'starting', 'ik-mb');
    await ctx.exchange.buyPlayer('u1', bellingham, 'bench',    'ik-bl');

    const before = ctx.wallet.getAvailable('u1');
    const results = await ctx.pipeline.dispatchBatch(scenario.events);

    assert.equal(results.length, scenario.events.length);
    assert.ok(results.every(r => r.durationMs >= 0));

    const after = ctx.wallet.getAvailable('u1');
    // Mbappé: 2 gol (400) + 1 man-of-match (100) = +500
    // Bellingham: 1 asist (100) = +100
    assert.ok(after > before, 'Final sonrası bakiye artmış olmalı');

    const match = ctx.pipeline.getMatch(scenario.matchId);
    assert.equal(match.events.length, scenario.events.length);
  });
});
