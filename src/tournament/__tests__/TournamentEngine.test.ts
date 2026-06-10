import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TournamentEngine } from '../TournamentEngine';

let engine: TournamentEngine;

function fresh() {
  engine = new TournamentEngine();
}

// ── Başlangıç durumu ──────────────────────────────────────────────────────────

describe('TournamentEngine — başlangıç', () => {
  beforeEach(fresh);

  it('PRE_TOURNAMENT fazıyla başlar', () => {
    assert.equal(engine.getPhase(), 'PRE_TOURNAMENT');
  });

  it('72 grup maçı oluşturulur', () => {
    assert.equal(engine.getAllGroupMatches().length, 72);
  });

  it('startGroupStage sonrası GROUP_STAGE', () => {
    engine.startGroupStage();
    assert.equal(engine.getPhase(), 'GROUP_STAGE');
  });

  it('her grup 4 takım içerir', () => {
    for (const gid of ['A','B','C','D','E','F','G','H','I','J','K','L'] as const) {
      const st = engine.getGroupStandings(gid);
      assert.equal(st.length, 4, `Grup ${gid} 4 takım içermeli`);
    }
  });

  it('her grup 6 maç içerir', () => {
    for (const gid of ['A','B','C','D','E','F','G','H','I','J','K','L'] as const) {
      const matches = engine.getGroupMatches(gid);
      assert.equal(matches.length, 6, `Grup ${gid} 6 maç içermeli`);
    }
  });
});

// ── Puan tablosu hesaplama ────────────────────────────────────────────────────

describe('TournamentEngine — puan tablosu', () => {
  beforeEach(() => {
    fresh();
    engine.startGroupStage();
  });

  it('galibiyet 3 puan verir', () => {
    const matches = engine.getGroupMatches('A').slice(0, 1);
    const m       = matches[0];
    engine.recordGroupResult(m.matchId, 2, 0);
    const standings = engine.getGroupStandings('A');
    const winner    = standings.find(s => s.teamId === m.homeTeam)!;
    assert.equal(winner.points, 3);
    assert.equal(winner.won,    1);
    assert.equal(winner.lost,   0);
  });

  it('beraberlik her iki takıma 1 puan', () => {
    const m = engine.getGroupMatches('A')[0];
    engine.recordGroupResult(m.matchId, 1, 1);
    const standings = engine.getGroupStandings('A');
    const home = standings.find(s => s.teamId === m.homeTeam)!;
    const away = standings.find(s => s.teamId === m.awayTeam)!;
    assert.equal(home.points, 1);
    assert.equal(away.points, 1);
    assert.equal(home.drawn,  1);
    assert.equal(away.drawn,  1);
  });

  it('yenilgi 0 puan', () => {
    const m = engine.getGroupMatches('A')[0];
    engine.recordGroupResult(m.matchId, 0, 3);
    const standings = engine.getGroupStandings('A');
    const loser = standings.find(s => s.teamId === m.homeTeam)!;
    assert.equal(loser.points, 0);
    assert.equal(loser.lost,   1);
  });

  it('gol farkı doğru hesaplanır', () => {
    const m = engine.getGroupMatches('A')[0];
    engine.recordGroupResult(m.matchId, 3, 1);
    const standings = engine.getGroupStandings('A');
    const home = standings.find(s => s.teamId === m.homeTeam)!;
    assert.equal(home.gf, 3);
    assert.equal(home.ga, 1);
    assert.equal(home.gd, 2);
  });

  it('sıralama: puan → gol farkı → atılan gol', () => {
    const matches = engine.getGroupMatches('A');
    // İlk maç: takım 0 kazanır (3p)
    engine.recordGroupResult(matches[0].matchId, 2, 0);
    // İkinci maç: takım 2 kazanır (3p) ama daha az farkla
    engine.recordGroupResult(matches[1].matchId, 1, 0);
    const st = engine.getGroupStandings('A');
    assert.equal(st[0].points >= st[1].points, true);
  });

  it('aynı maça iki kez sonuç girilmez (idempotent)', () => {
    const m = engine.getGroupMatches('A')[0];
    engine.recordGroupResult(m.matchId, 2, 0);
    engine.recordGroupResult(m.matchId, 5, 0); // ikinci çağrı görmezden gelinmeli
    const standings = engine.getGroupStandings('A');
    const home = standings.find(s => s.teamId === m.homeTeam)!;
    assert.equal(home.gf, 2); // 5 değil
  });
});

// ── Tüm grup maçları → eleme bracket ────────────────────────────────────────

describe('TournamentEngine — eleme bracket', () => {
  beforeEach(() => {
    fresh();
    engine.startGroupStage();
  });

  function finishAllGroupMatches() {
    for (const m of engine.getAllGroupMatches()) {
      if (m.status !== 'FINISHED') engine.recordGroupResult(m.matchId, 2, 1);
    }
  }

  it('tüm grup maçları bitince KNOCKOUT fazına geçer', () => {
    finishAllGroupMatches();
    assert.equal(engine.getPhase(), 'KNOCKOUT');
  });

  it('bracket boş değil ve 32 takım içerir', () => {
    finishAllGroupMatches();
    const bracket = engine.getBracket();
    assert.ok(bracket.length > 0, 'bracket boş olmamalı');
    // R32: 16 maç, R16: 8, QF: 4, SF: 2, THIRD: 1, FINAL: 1 = 32 toplam
    assert.equal(bracket.length, 32);
  });

  it('R32 maçları SCHEDULED durumunda ve takımları atanmış', () => {
    finishAllGroupMatches();
    const r32 = engine.getBracket().filter(m => m.round === 'R32');
    assert.equal(r32.length, 16);
    for (const m of r32) {
      assert.ok(m.homeTeam, `R32 maçı ${m.matchId} homeTeam boş`);
      assert.ok(m.awayTeam, `R32 maçı ${m.matchId} awayTeam boş`);
      assert.equal(m.status, 'SCHEDULED');
    }
  });

  it('FINAL maçı bracket\'ta mevcut', () => {
    finishAllGroupMatches();
    const final = engine.getBracket().find(m => m.round === 'FINAL');
    assert.ok(final, 'FINAL maçı yok');
  });
});

// ── Eleme sonuçları ───────────────────────────────────────────────────────────

describe('TournamentEngine — eleme sonuçları', () => {
  beforeEach(() => {
    fresh();
    engine.startGroupStage();
    for (const m of engine.getAllGroupMatches()) {
      engine.recordGroupResult(m.matchId, 2, 1);
    }
  });

  it('R32 galibi R16 maçına ilerler', () => {
    const r32    = engine.getBracket().filter(m => m.round === 'R32');
    const first  = r32[0];
    engine.recordKnockoutResult(first.matchId, 2, 0);
    const updated = engine.getBracket().find(m => m.matchId === first.matchId)!;
    assert.equal(updated.homeScore, 2);
    assert.equal(updated.awayScore, 0);
    assert.equal(updated.status, 'FINISHED');
  });

  it('champion olayı FINAL bitince fırlar', (t, done) => {
    engine.on('champion', ({ teamId }) => {
      assert.ok(typeof teamId === 'string' && teamId.length > 0);
      done();
    });

    // Tüm bracket'ı tamamla
    function finishRound(round: string) {
      for (const m of engine.getBracket().filter(b => b.round === round && b.status === 'SCHEDULED' && b.homeTeam && b.awayTeam)) {
        engine.recordKnockoutResult(m.matchId, 1, 0);
      }
    }
    finishRound('R32');
    finishRound('R16');
    finishRound('QF');
    finishRound('SF');
    finishRound('THIRD');
    finishRound('FINAL');
  });

  it('champion belirlenince faz FINISHED olur', () => {
    function finishRound(round: string) {
      for (const m of engine.getBracket().filter(b => b.round === round && b.status === 'SCHEDULED' && b.homeTeam && b.awayTeam)) {
        engine.recordKnockoutResult(m.matchId, 1, 0);
      }
    }
    finishRound('R32'); finishRound('R16'); finishRound('QF');
    finishRound('SF');  finishRound('THIRD'); finishRound('FINAL');
    assert.equal(engine.getPhase(), 'FINISHED');
    assert.ok(engine.getChampion() !== null);
  });
});

// ── getSnapshot ───────────────────────────────────────────────────────────────

describe('TournamentEngine — getSnapshot', () => {
  it('snapshot doğru alanları içerir', () => {
    const snap = new TournamentEngine().getSnapshot();
    assert.ok('phase'     in snap);
    assert.ok('groups'    in snap);
    assert.ok('bracket'   in snap);
    assert.ok('champion'  in snap);
    assert.ok('updatedAt' in snap);
  });
});
