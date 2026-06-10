import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SquadManager, SQUAD_LIMITS } from '../SquadManager';
import { Player } from '../types';
import {
  SquadCapacityError,
  PlayerAlreadyInSquadError,
  PlayerNotInSquadError,
} from '../errors';

function makePlayer(id: string, position: Player['position'] = 'MID'): Player {
  return { id, name: `Oyuncu ${id}`, position, marketPrice: 100, performanceScore: 0 };
}

describe('SquadManager — temel işlemler', () => {
  it('kadro başlangıçta boş olur', () => {
    const sm   = new SquadManager();
    const snap = sm.createSquad('u1');
    assert.equal(snap.entries.length, 0);
    assert.equal(snap.version, 0);
  });

  it('başlangıç kadrosuna oyuncu eklenir', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    sm.addPlayer('u1', makePlayer('p1'), 'starting');
    assert.ok(sm.hasPlayer('u1', 'p1'));
    assert.equal(sm.slotCount('u1', 'starting'), 1);
  });

  it('yedek bankına oyuncu eklenir', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    sm.addPlayer('u1', makePlayer('p1'), 'bench');
    assert.equal(sm.slotCount('u1', 'bench'), 1);
  });

  it('oyuncu kadroden çıkarılabilir', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    sm.addPlayer('u1', makePlayer('p1'), 'starting');
    const entry = sm.removePlayer('u1', 'p1');
    assert.equal(entry.player.id, 'p1');
    assert.ok(!sm.hasPlayer('u1', 'p1'));
  });

  it('version her değişimde artar', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    const v0 = sm.getSquad('u1').version;
    sm.addPlayer('u1', makePlayer('p1'), 'starting');
    assert.ok(sm.getSquad('u1').version > v0);
  });
});

describe('SquadManager — kapasite kuralları (11+3)', () => {
  it('başlangıç 11 oyuncuya kadar kabul eder', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    for (let i = 0; i < SQUAD_LIMITS.starting; i++) {
      sm.addPlayer('u1', makePlayer(`p${i}`), 'starting');
    }
    assert.equal(sm.slotCount('u1', 'starting'), 11);
  });

  it('12. başlangıç oyuncusu SquadCapacityError fırlatır', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    for (let i = 0; i < SQUAD_LIMITS.starting; i++) {
      sm.addPlayer('u1', makePlayer(`p${i}`), 'starting');
    }
    assert.throws(
      () => sm.addPlayer('u1', makePlayer('p11'), 'starting'),
      SquadCapacityError,
    );
  });

  it('yedek banka 3 oyuncuya kadar kabul eder', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    for (let i = 0; i < SQUAD_LIMITS.bench; i++) {
      sm.addPlayer('u1', makePlayer(`b${i}`), 'bench');
    }
    assert.equal(sm.slotCount('u1', 'bench'), 3);
  });

  it('4. yedek oyuncusu SquadCapacityError fırlatır', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    for (let i = 0; i < SQUAD_LIMITS.bench; i++) {
      sm.addPlayer('u1', makePlayer(`b${i}`), 'bench');
    }
    assert.throws(
      () => sm.addPlayer('u1', makePlayer('b3'), 'bench'),
      SquadCapacityError,
    );
  });

  it('toplam 14 oyuncu (11+3) kadroyu doldurur', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    for (let i = 0; i < 11; i++) sm.addPlayer('u1', makePlayer(`s${i}`), 'starting');
    for (let i = 0; i < 3;  i++) sm.addPlayer('u1', makePlayer(`b${i}`), 'bench');
    assert.equal(sm.totalCount('u1'), 14);
  });
});

describe('SquadManager — tekrar eden oyuncu', () => {
  it('aynı oyuncu iki kez eklenemez', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    sm.addPlayer('u1', makePlayer('p1'), 'starting');
    assert.throws(
      () => sm.addPlayer('u1', makePlayer('p1'), 'bench'),
      PlayerAlreadyInSquadError,
    );
  });

  it('kadroda olmayan oyuncu çıkarılmaya çalışılırsa hata fırlatılır', () => {
    const sm = new SquadManager();
    sm.createSquad('u1');
    assert.throws(
      () => sm.removePlayer('u1', 'p999'),
      PlayerNotInSquadError,
    );
  });
});
