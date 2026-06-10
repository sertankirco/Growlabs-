import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { WalletEngine } from '../WalletEngine';
import { InsufficientFundsError } from '../errors';

let engine: WalletEngine;

function fresh(balance = 1000) {
  engine = new WalletEngine();
  engine.createWallet('u1', balance);
}

// ── Temel işlemler ────────────────────────────────────────────────────────────

describe('WalletEngine — temel işlemler', () => {
  beforeEach(() => fresh());

  it('başlangıç bakiyesi doğru atanır', () => {
    const w = engine.getWallet('u1');
    assert.equal(w.balance, 1000);
    assert.equal(w.reserved, 0);
  });

  it('available = balance − reserved', async () => {
    await engine.reserveFunds('u1', 300, 'ik1');
    assert.equal(engine.getAvailable('u1'), 700);
  });

  it('commit sonrası balance düşer, reserved sıfırlanır', async () => {
    const tx = await engine.reserveFunds('u1', 300, 'ik1');
    await engine.commitReservation(tx.txId);
    const snap = engine.getWallet('u1');
    assert.equal(snap.balance, 700);
    assert.equal(snap.reserved, 0);
  });

  it('rollback sonrası available tam geri gelir', async () => {
    const tx = await engine.reserveFunds('u1', 300, 'ik1');
    await engine.rollbackReservation(tx.txId);
    assert.equal(engine.getAvailable('u1'), 1000);
    assert.equal(engine.getWallet('u1').reserved, 0);
  });

  it('credit bakiyeyi artırır', async () => {
    await engine.credit('u1', 500, 'SELL_PLAYER', 'ik-sell');
    assert.equal(engine.getAvailable('u1'), 1500);
  });

  it('version her işlemde artar', async () => {
    const v0 = engine.getWallet('u1').version;
    await engine.reserveFunds('u1', 100, 'ik1');
    assert.ok(engine.getWallet('u1').version > v0);
  });
});

// ── Çift harcama önleme ───────────────────────────────────────────────────────

describe('WalletEngine — çift harcama önleme', () => {
  it('bakiyeyi aşan iki eşzamanlı rezervasyondan yalnızca biri başarılı olur', async () => {
    fresh(1000);
    const results = await Promise.allSettled([
      engine.reserveFunds('u1', 600, 'ik-a'),
      engine.reserveFunds('u1', 600, 'ik-b'),
    ]);
    const ok   = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.filter(r => r.status === 'rejected').length;
    assert.equal(ok, 1);
    assert.equal(fail, 1);
    assert.equal(engine.getWallet('u1').reserved, 600);
  });

  it('5 eşzamanlı istek — yalnızca sığan kadarı kabul edilir', async () => {
    fresh(1000);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        engine.reserveFunds('u1', 300, `ik-${i}`),
      ),
    );
    const ok = results.filter(r => r.status === 'fulfilled').length;
    assert.ok(ok <= 3);
    assert.ok(engine.getWallet('u1').reserved <= 1000);
  });

  it('InsufficientFundsError fırlatılır', async () => {
    fresh(500);
    await assert.rejects(
      () => engine.reserveFunds('u1', 600, 'ik1'),
      InsufficientFundsError,
    );
  });

  it('sıfır bakiyede rezervasyon reddedilir', async () => {
    fresh(0);
    await assert.rejects(
      () => engine.reserveFunds('u1', 1, 'ik1'),
      InsufficientFundsError,
    );
  });

  it('rollback sonrası eşdeğer rezervasyon başarılı olur', async () => {
    fresh(1000);
    const results = await Promise.allSettled([
      engine.reserveFunds('u1', 700, 'ik-a'),
      engine.reserveFunds('u1', 700, 'ik-b'),
    ]);
    const ok = results.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
    if (ok) await engine.rollbackReservation(ok.value.txId);
    assert.equal(engine.getAvailable('u1'), 1000);
    await assert.doesNotReject(() => engine.reserveFunds('u1', 700, 'ik-retry'));
  });
});

// ── İdempotency ───────────────────────────────────────────────────────────────

describe('WalletEngine — idempotency', () => {
  it('aynı key tekrar çağrılırsa orijinal tx döner, bakiye değişmez', async () => {
    fresh(1000);
    const tx1 = await engine.reserveFunds('u1', 100, 'ik-same');
    const tx2 = await engine.reserveFunds('u1', 100, 'ik-same');
    assert.equal(tx1.txId, tx2.txId);
    assert.equal(engine.getWallet('u1').reserved, 100);
  });

  it('credit idempotency — aynı key tek sefer uygulanır', async () => {
    fresh(1000);
    await engine.credit('u1', 200, 'SELL_PLAYER', 'ik-sell');
    await engine.credit('u1', 200, 'SELL_PLAYER', 'ik-sell');
    assert.equal(engine.getAvailable('u1'), 1200);
  });

  it('rollback sonrası aynı key ile yeniden rezervasyon yapılabilir', async () => {
    fresh(1000);
    const tx = await engine.reserveFunds('u1', 300, 'ik-retry');
    await engine.rollbackReservation(tx.txId);
    const tx2 = await engine.reserveFunds('u1', 300, 'ik-retry');
    assert.equal(tx2.status, 'PENDING');
    assert.equal(engine.getWallet('u1').reserved, 300);
  });
});

// ── İşlem geçmişi ─────────────────────────────────────────────────────────────

describe('WalletEngine — işlem geçmişi', () => {
  it('geçmiş yalnızca ilgili kullanıcının kayıtlarını içerir', async () => {
    const e = new WalletEngine();
    e.createWallet('u1', 1000);
    e.createWallet('u2', 1000);
    await e.credit('u1', 100, 'DEPOSIT', 'ik-u1');
    await e.credit('u2', 100, 'DEPOSIT', 'ik-u2');
    const history = e.getHistory('u1');
    assert.equal(history.length, 1);
    assert.equal(history[0].userId, 'u1');
  });

  it('geçmiş en yeni işlem önce sıralanır', async () => {
    fresh(1000);
    await engine.credit('u1', 100, 'DEPOSIT', 'ik1');
    await engine.credit('u1', 200, 'DEPOSIT', 'ik2');
    const [first, second] = engine.getHistory('u1');
    assert.ok(first.timestamp >= second.timestamp);
  });
});
