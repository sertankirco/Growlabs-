import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TransferWindow } from '../TransferWindow';

let tw: TransferWindow;

function fresh() { tw = new TransferWindow(); }

// ── Başlangıç durumu ──────────────────────────────────────────────────────────

describe('TransferWindow — başlangıç', () => {
  beforeEach(fresh);

  it('başlangıçta OPEN', () => {
    assert.equal(tw.getStatus(), 'OPEN');
  });

  it('check() başlangıçta allowed=true', () => {
    assert.equal(tw.check().allowed, true);
  });

  it('snapshot başlangıç değerleri doğru', () => {
    const s = tw.getSnapshot();
    assert.equal(s.status,        'OPEN');
    assert.equal(s.closedReason,  null);
    assert.equal(s.closedAt,      null);
    assert.equal(s.activeMatches, 0);
  });
});

// ── close() ───────────────────────────────────────────────────────────────────

describe('TransferWindow — close', () => {
  beforeEach(fresh);

  it('close() pencereyi kapatır', () => {
    tw.close('match-1', 'Maç devam ediyor');
    assert.equal(tw.getStatus(), 'CLOSED');
  });

  it('close() sonrası check() allowed=false', () => {
    tw.close('match-1', 'Test maçı');
    const result = tw.check();
    assert.equal(result.allowed, false);
    assert.equal(result.reason,  'Test maçı');
  });

  it('close() closedAt ayarlanır', () => {
    const before = Date.now();
    tw.close('match-1', 'x');
    const after  = Date.now();
    const s = tw.getSnapshot();
    assert.ok(s.closedAt !== null);
    assert.ok(s.closedAt! >= before && s.closedAt! <= after);
  });

  it('close() activeMatches artar', () => {
    tw.close('m1', 'x');
    assert.equal(tw.getSnapshot().activeMatches, 1);
    tw.close('m2', 'y');
    assert.equal(tw.getSnapshot().activeMatches, 2);
  });

  it('aynı matchId ile ikinci close() etki yaratmaz', () => {
    tw.close('m1', 'ilk');
    tw.close('m1', 'ikinci');
    assert.equal(tw.getSnapshot().activeMatches, 1);
    assert.equal(tw.getSnapshot().closedReason, 'ilk');
  });

  it('closed event fırlar', (t, done) => {
    tw.on('closed', ({ reason, matchId }) => {
      assert.equal(reason,  'Test');
      assert.equal(matchId, 'match-x');
      done();
    });
    tw.close('match-x', 'Test');
  });

  it('zaten CLOSED iken close() çağrılsa event tekrar fırlamamalı', () => {
    let count = 0;
    tw.on('closed', () => count++);
    tw.close('m1', 'x');
    tw.close('m2', 'y'); // ikinci çağrı: status zaten CLOSED
    assert.equal(count, 1);
  });
});

// ── open() ────────────────────────────────────────────────────────────────────

describe('TransferWindow — open', () => {
  beforeEach(fresh);

  it('tek maç bitti → pencere açılır', () => {
    tw.close('m1', 'x');
    tw.open('m1');
    assert.equal(tw.getStatus(), 'OPEN');
  });

  it('iki maç: biri bitti → hâlâ CLOSED', () => {
    tw.close('m1', 'x');
    tw.close('m2', 'y');
    tw.open('m1');
    assert.equal(tw.getStatus(), 'CLOSED');
    assert.equal(tw.getSnapshot().activeMatches, 1);
  });

  it('iki maç: ikisi de bitti → OPEN', () => {
    tw.close('m1', 'x');
    tw.close('m2', 'y');
    tw.open('m1');
    tw.open('m2');
    assert.equal(tw.getStatus(), 'OPEN');
    assert.equal(tw.getSnapshot().closedReason, null);
    assert.equal(tw.getSnapshot().closedAt,     null);
  });

  it('open() OPEN durumdayken etki yaratmaz', () => {
    tw.open('hayali-mac'); // zaten açık
    assert.equal(tw.getStatus(), 'OPEN');
  });

  it('opened event fırlar', (t, done) => {
    tw.on('opened', () => done());
    tw.close('m1', 'x');
    tw.open('m1');
  });
});

// ── forceOpen() ───────────────────────────────────────────────────────────────

describe('TransferWindow — forceOpen', () => {
  beforeEach(fresh);

  it('iptal maçı kuyruğu temizler ve pencereyi açar', () => {
    tw.close('m1', 'x');
    tw.close('m2', 'y');
    tw.forceOpen('m1');
    assert.equal(tw.getSnapshot().activeMatches, 1);
    tw.forceOpen('m2');
    assert.equal(tw.getStatus(), 'OPEN');
  });

  it('kapalı iken tek forceOpen sonrası OPEN', () => {
    tw.close('m1', 'z');
    tw.forceOpen('m1');
    assert.equal(tw.getStatus(), 'OPEN');
  });
});
