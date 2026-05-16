import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken } from '../jwt';

const SECRET = 'test-secret-key';

describe('JWT HS256', () => {
  it('token üretir ve doğrular', () => {
    const token   = signToken('sertan', SECRET);
    const payload = verifyToken(token, SECRET);
    assert.ok(payload);
    assert.equal(payload!.userId, 'sertan');
  });

  it('yanlış secret ile doğrulama başarısız olur', () => {
    const token = signToken('sertan', SECRET);
    assert.equal(verifyToken(token, 'yanlis-secret'), null);
  });

  it('bozulmuş token reddedilir', () => {
    const token = signToken('sertan', SECRET);
    const parts  = token.split('.');
    parts[2]     = 'bozulmus_imza';
    assert.equal(verifyToken(parts.join('.'), SECRET), null);
  });

  it('süresi dolmuş token reddedilir', () => {
    const token = signToken('sertan', SECRET, -1);  // geçmişte süresi dolmuş
    assert.equal(verifyToken(token, SECRET), null);
  });

  it('geçersiz format reddedilir', () => {
    assert.equal(verifyToken('bir.iki', SECRET), null);
    assert.equal(verifyToken('', SECRET), null);
  });

  it('userId payload içinde doğru saklanır', () => {
    const token   = signToken('ali_veli', SECRET, 1);
    const payload = verifyToken(token, SECRET);
    assert.equal(payload!.userId, 'ali_veli');
    assert.ok(payload!.iat > 0);
    assert.ok(payload!.exp > payload!.iat);
  });
});
