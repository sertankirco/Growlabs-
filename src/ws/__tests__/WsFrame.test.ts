import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAcceptKey, encodeFrame, encodeText, encodePong, encodeClose,
  decodeFrames, Opcode,
} from '../WsFrame';

// ── Handshake ─────────────────────────────────────────────────────────────────

describe('WsFrame — handshake', () => {
  it('RFC 6455 örnek anahtarı doğru hesaplar', () => {
    // RFC 6455 §1.3'ten resmi test vektörü
    const clientKey = 'dGhlIHNhbXBsZSBub25jZQ==';
    const expected  = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=';
    assert.equal(buildAcceptKey(clientKey), expected);
  });
});

// ── Frame Encode ──────────────────────────────────────────────────────────────

describe('WsFrame — encode', () => {
  it('küçük metin frame\'i doğru kodlanır (≤125 byte)', () => {
    const buf = encodeFrame(Opcode.TEXT, Buffer.from('Merhaba'));
    assert.equal(buf[0], 0x81);         // FIN=1, opcode=TEXT
    assert.equal(buf[1], 7);            // MASK=0, payload len=7
    assert.equal(buf.slice(2).toString(), 'Merhaba');
  });

  it('126–65535 byte payload 16-bit extended length kullanır', () => {
    const payload = Buffer.alloc(200, 'x');
    const buf     = encodeFrame(Opcode.BINARY, payload);
    assert.equal(buf[1], 126);
    assert.equal(buf.readUInt16BE(2), 200);
    assert.equal(buf.length, 4 + 200);
  });

  it('JSON mesajı encodeText ile kodlanır ve JSON olarak açılır', () => {
    const msg  = { type: 'WALLET_UPDATE', userId: 'u1', available: 5000 };
    const buf  = encodeText(msg);
    const text = buf.slice(2).toString('utf8'); // 2 byte header
    assert.deepEqual(JSON.parse(text), msg);
  });

  it('PONG frame opcode 0xA olarak ayarlanır', () => {
    const buf = encodePong();
    assert.equal(buf[0] & 0x0F, Opcode.PONG);
  });

  it('CLOSE frame 1000 kodu içerir', () => {
    const buf  = encodeClose(1000, 'test');
    assert.equal(buf[0] & 0x0F, Opcode.CLOSE);
    const code = buf.readUInt16BE(2); // 2 byte header + 2 byte code
    assert.equal(code, 1000);
  });
});

// ── Frame Decode ──────────────────────────────────────────────────────────────

describe('WsFrame — decode', () => {
  it('masksız frame decode edilir', () => {
    const original = 'Merhaba dünya';
    const encoded  = encodeText(original);
    const { frames, remaining } = decodeFrames(encoded);

    assert.equal(frames.length, 1);
    assert.equal(frames[0].opcode, Opcode.TEXT);
    assert.equal(frames[0].fin, true);
    assert.equal(frames[0].payload.toString('utf8'), JSON.stringify(original));
    assert.equal(remaining.length, 0);
  });

  it('maskeli istemci frame\'i decode edilip unmask edilir', () => {
    // İstemci tarafından maskeli olarak gelen frame'i simüle et
    const payload    = Buffer.from('{ "type": "PING" }', 'utf8');
    const maskKey    = Buffer.from([0x37, 0xfa, 0x21, 0x3d]);
    const masked     = Buffer.from(payload.map((b, i) => b ^ maskKey[i % 4]));

    const frame      = Buffer.allocUnsafe(2 + 4 + masked.length);
    frame[0]         = 0x81;                  // FIN + TEXT
    frame[1]         = 0x80 | payload.length; // MASK=1 + len
    maskKey.copy(frame, 2);
    masked.copy(frame, 6);

    const { frames } = decodeFrames(frame);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].masked, true);
    assert.equal(frames[0].payload.toString('utf8'), '{ "type": "PING" }');
  });

  it('eksik veri geldiğinde boş frame listesi + remaining döner', () => {
    const full     = encodeText({ type: 'TEST' });
    const partial  = full.slice(0, full.length - 2); // son 2 byte eksik

    const { frames, remaining } = decodeFrames(partial);
    assert.equal(frames.length, 0);
    assert.equal(remaining.length, partial.length);
  });

  it('iki art arda frame aynı buffer\'dan çözülür', () => {
    const f1   = encodeText({ type: 'MSG', n: 1 });
    const f2   = encodeText({ type: 'MSG', n: 2 });
    const both = Buffer.concat([f1, f2]);

    const { frames, remaining } = decodeFrames(both);
    assert.equal(frames.length, 2);
    assert.equal(remaining.length, 0);

    const m1 = JSON.parse(frames[0].payload.toString('utf8'));
    const m2 = JSON.parse(frames[1].payload.toString('utf8'));
    assert.equal(m1.n, 1);
    assert.equal(m2.n, 2);
  });

  it('büyük payload (1000 byte) encode + decode round-trip', () => {
    const big = 'A'.repeat(1000);
    const enc = encodeFrame(Opcode.TEXT, Buffer.from(big));
    const { frames } = decodeFrames(enc);
    assert.equal(frames.length, 1);
    assert.equal(frames[0].payload.toString('utf8'), big);
  });
});

// ── WsServer abonelik mantığı (izole, TCP gerektirmez) ───────────────────────

describe('WsServer — kanal abonelik mantığı', () => {
  it('WsConnection subscribe/unsubscribe kanal takibi yapar', () => {
    // Socket mock'u (write metodu olan basit nesne)
    const mockSocket: any = {
      writable: true,
      write: () => true,
      on: () => mockSocket,
      end: () => {},
    };

    // WsConnection'ı içe aktar ve test et
    const { WsConnection } = require('../WsConnection');
    const conn = new WsConnection(
      mockSocket,
      () => {}, // onMessage
      () => {}, // onClose
    );

    conn.subscribe('market');
    conn.subscribe('wallet:u1');
    assert.ok(conn.isSubscribed('market'));
    assert.ok(conn.isSubscribed('wallet:u1'));
    assert.ok(!conn.isSubscribed('wallet:u2'));

    conn.unsubscribe('market');
    assert.ok(!conn.isSubscribed('market'));

    const channels = conn.getChannels();
    assert.deepEqual(channels, ['wallet:u1']);
  });
});
