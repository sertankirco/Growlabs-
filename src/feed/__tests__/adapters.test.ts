import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';

import { PlayerRegistry }     from '../PlayerRegistry';
import { SportradarAdapter }  from '../SportradarAdapter';
import { OptaAdapter }        from '../OptaAdapter';
import { FeedReplay }         from '../FeedReplay';
import { createGameContext, bootstrapUser, registerPlayers } from '../../context/GameContext';
import { WORLD_CUP_PLAYERS } from '../../mock/MatchSimulator';
import { SrTimeline }         from '../types';

// ── PlayerRegistry ────────────────────────────────────────────────────────────

describe('PlayerRegistry', () => {
  it('Sportradar ID\'yi internal ID\'ye çevirir', () => {
    const reg  = new PlayerRegistry();
    const meta = reg.resolve('SPORTRADAR', 'sr:player:840306');
    assert.ok(meta, 'Mbappé kayıtlı olmalı');
    assert.equal(meta!.internalId, 'mbappe');
    assert.equal(meta!.position,   'FWD');
  });

  it('Opta ID\'yi internal ID\'ye çevirir', () => {
    const reg  = new PlayerRegistry();
    const meta = reg.resolve('OPTA', 'p4166');
    assert.equal(meta!.internalId, 'mbappe');
  });

  it('bilinmeyen ID undefined döner', () => {
    const reg = new PlayerRegistry();
    assert.equal(reg.resolve('SPORTRADAR', 'sr:player:9999999'), undefined);
  });

  it('resolveOrRegister yeni oyuncu ekler', () => {
    const reg  = new PlayerRegistry();
    const meta = reg.resolveOrRegister('SPORTRADAR', 'sr:player:999', 'Yeni Oyuncu', 'MID');
    assert.equal(meta.internalId, 'yeni-oyuncu');
    assert.equal(reg.resolve('SPORTRADAR', 'sr:player:999')?.internalId, 'yeni-oyuncu');
  });
});

// ── SportradarAdapter ─────────────────────────────────────────────────────────

describe('SportradarAdapter — normalize', () => {
  let adapter: SportradarAdapter;

  beforeEach(() => {
    adapter = new SportradarAdapter(new PlayerRegistry());
  });

  it('score_change olayını GOAL event\'ine dönüştürür', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{
        id:         1,
        type:       'score_change',
        match_time: 18,
        player:     { id: 'sr:player:840306', name: 'Mbappé' },
        method:     'regular',
        home_score: 1,
        away_score: 0,
      }],
    };

    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type,     'GOAL');
    assert.equal(events[0].playerId, 'mbappe');
    assert.equal(events[0].minute,   18);
  });

  it('score_change + assist → GOL + ASİST iki ayrı event üretir', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{
        id:         2,
        type:       'score_change',
        match_time: 34,
        player:     { id: 'sr:player:840306', name: 'Mbappé' },
        assist:     { id: 'sr:player:1456604', name: 'Bellingham' },
        method:     'regular',
      }],
    };

    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events.length, 2);
    assert.ok(events.some(e => e.type === 'GOAL'   && e.playerId === 'mbappe'));
    assert.ok(events.some(e => e.type === 'ASSIST' && e.playerId === 'bellingham'));
  });

  it('own_goal method\'u OWN_GOAL event\'i üretir', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{
        id:         3,
        type:       'score_change',
        match_time: 55,
        player:     { id: 'sr:player:44030', name: 'Van Dijk' },
        method:     'own_goal',
      }],
    };

    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'OWN_GOAL');
  });

  it('sarı kart olayı YELLOW_CARD üretir', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{
        id: 4, type: 'yellow_card', match_time: 41,
        player: { id: 'sr:player:1128428', name: 'Militao' },
      }],
    };
    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events[0].type, 'YELLOW_CARD');
    assert.equal(events[0].playerId, 'militao');
  });

  it('tanınmayan event tipi → boş dizi döner', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{ id: 5, type: 'match_started', match_time: 0 }],
    };
    assert.equal(adapter.normalize(payload, 'match-1').length, 0);
  });

  it('bilinmeyen oyuncu ID\'si → event atlanır', () => {
    const payload: SrTimeline = {
      sport_event: { id: 'sr:sport_event:1', competitors: [] },
      timeline: [{
        id: 6, type: 'score_change', match_time: 60,
        player: { id: 'sr:player:9999999', name: 'Yabancı' },
      }],
    };
    assert.equal(adapter.normalize(payload, 'match-1').length, 0);
  });
});

// ── SportradarAdapter — HMAC imza doğrulama ───────────────────────────────────

describe('SportradarAdapter — imza doğrulama', () => {
  it('geçerli HMAC imza kabul edilir', () => {
    const secret  = 'super-secret-key';
    const adapter = new SportradarAdapter(new PlayerRegistry(), secret);
    const body    = Buffer.from('{"test": true}');
    const sig     = createHmac('sha256', secret).update(body).digest('hex');
    assert.ok(adapter.verifySignature(body, { 'x-sr-api-signature': sig }));
  });

  it('yanlış imza reddedilir', () => {
    const adapter = new SportradarAdapter(new PlayerRegistry(), 'correct-secret');
    const body    = Buffer.from('{"test": true}');
    assert.ok(!adapter.verifySignature(body, { 'x-sr-api-signature': 'yanlis-imza' }));
  });

  it('sır yoksa (dev modu) her imza geçer', () => {
    const adapter = new SportradarAdapter(new PlayerRegistry(), '');
    assert.ok(adapter.verifySignature(Buffer.from('x'), {}));
  });
});

// ── OptaAdapter ───────────────────────────────────────────────────────────────

describe('OptaAdapter — normalize', () => {
  let adapter: OptaAdapter;

  beforeEach(() => {
    adapter = new OptaAdapter(new PlayerRegistry());
  });

  it('type_id=16 GOAL üretir', () => {
    const payload = {
      Game: {
        id: 'g1', home_team: 'FRA', away_team: 'BRA',
        Event: { id: '1', event_id: '1', type_id: '16', period_id: '1', min: '18', player_id: 'p4166' },
      },
    };
    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events.length, 1);
    assert.equal(events[0].type,     'GOAL');
    assert.equal(events[0].playerId, 'mbappe');
  });

  it('type_id=31 YELLOW_CARD üretir', () => {
    const payload = {
      Game: {
        id: 'g1', home_team: 'FRA', away_team: 'BRA',
        Event: { id: '2', event_id: '2', type_id: '31', period_id: '1', min: '41', player_id: 'p452491' },
      },
    };
    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events[0].type, 'YELLOW_CARD');
    assert.equal(events[0].playerId, 'militao');
  });

  it('own goal qualifier OWN_GOAL\'a dönüşür', () => {
    const payload = {
      Game: {
        id: 'g1', home_team: 'FRA', away_team: 'BRA',
        Event: {
          id: '3', event_id: '3', type_id: '16', period_id: '1', min: '55',
          player_id: 'p36217',
          qualifier: [{ qualifier_id: '82' }], // own goal qualifier
        },
      },
    };
    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events[0].type, 'OWN_GOAL');
  });

  it('Event array olduğunda tüm eventler işlenir', () => {
    const payload = {
      Game: {
        id: 'g1', home_team: 'FRA', away_team: 'BRA',
        Event: [
          { id: '1', event_id: '1', type_id: '16', period_id: '1', min: '18', player_id: 'p4166' },
          { id: '2', event_id: '2', type_id: '31', period_id: '1', min: '41', player_id: 'p452491' },
        ],
      },
    };
    const events = adapter.normalize(payload, 'match-1');
    assert.equal(events.length, 2);
  });
});

// ── FeedReplay ────────────────────────────────────────────────────────────────

describe('FeedReplay — senaryo oynatma', () => {
  it('final senaryosunu yükler ve tüm eventleri dispatch eder', async () => {
    const ctx = createGameContext();
    bootstrapUser(ctx, 'u1', 10_000);
    registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));

    // Mbappé ve Bellingham satın al
    const mbappe     = WORLD_CUP_PLAYERS.find(p => p.id === 'mbappe')!;
    const bellingham = WORLD_CUP_PLAYERS.find(p => p.id === 'bellingham')!;
    await ctx.exchange.buyPlayer('u1', mbappe,     'starting', 'ik-mb');
    await ctx.exchange.buyPlayer('u1', bellingham, 'bench',    'ik-bl');

    const before = ctx.wallet.getAvailable('u1');

    const replay = new FeedReplay(ctx.pipeline);
    replay.loadScenario('final');
    const count = await replay.playAll();

    assert.ok(count > 0, `${count} event oynatıldı`);
    assert.ok(ctx.wallet.getAvailable('u1') > before, 'Bakiye artmalıydı');
  });

  it('stop() replay\'i durdurur', async () => {
    const ctx = createGameContext();
    registerPlayers(ctx, WORLD_CUP_PLAYERS.map(p => ({ player: p, basePrice: p.marketPrice })));

    const replay = new FeedReplay(ctx.pipeline);
    replay.loadScenario('random');

    // start'ı arkaplanda başlat ve hemen durdur
    const promise = replay.start(1000);
    replay.stop();
    await promise;
    assert.ok(!replay.isRunning);
  });

  it('senaryo yüklenmeden start() hata fırlatır', async () => {
    const ctx    = createGameContext();
    const replay = new FeedReplay(ctx.pipeline);
    await assert.rejects(() => replay.start(), /Senaryo yüklenmemiş|Önce loadScenario/);
  });
});
