import { createHash } from 'crypto';

// ── RFC 6455 WebSocket Frame Motoru ───────────────────────────────────────────
//
// Sıfır dış bağımlılık — Node.js crypto + Buffer ile tam WebSocket implementasyonu.
//
// Frame yapısı:
//   Byte 0: FIN(1) RSV1-3(3) Opcode(4)
//   Byte 1: MASK(1) PayloadLen(7)
//   [Byte 2-3 veya 2-9]: Extended payload length (126 veya 127 ise)
//   [4 byte]: Masking key (istemci→sunucu ise)
//   [N byte]: Payload data

export const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const Opcode = {
  CONTINUATION: 0x0,
  TEXT:         0x1,
  BINARY:       0x2,
  CLOSE:        0x8,
  PING:         0x9,
  PONG:         0xA,
} as const;

export type Opcode = typeof Opcode[keyof typeof Opcode];

export interface WsFrame {
  fin:     boolean;
  opcode:  Opcode;
  masked:  boolean;
  payload: Buffer;
}

// ── Handshake ─────────────────────────────────────────────────────────────────

export function buildAcceptKey(clientKey: string): string {
  return createHash('sha1')
    .update(clientKey + WS_MAGIC)
    .digest('base64');
}

export function buildHandshakeResponse(clientKey: string): string {
  return [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${buildAcceptKey(clientKey)}`,
    '\r\n',
  ].join('\r\n');
}

// ── Frame Encode (sunucu → istemci, masksız) ──────────────────────────────────

export function encodeFrame(opcode: Opcode, payload: Buffer | string, fin = true): Buffer {
  const data   = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const len    = data.length;

  let headerLen: number;
  if      (len <= 125)     headerLen = 2;
  else if (len <= 0xFFFF)  headerLen = 4;   // 16-bit extended
  else                     headerLen = 10;  // 64-bit extended

  const frame = Buffer.allocUnsafe(headerLen + len);
  frame[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0F);

  if (len <= 125) {
    frame[1] = len;                        // MASK=0, len direkt
  } else if (len <= 0xFFFF) {
    frame[1] = 126;
    frame.writeUInt16BE(len, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(len), 2);
  }

  data.copy(frame, headerLen);
  return frame;
}

export function encodeText(json: unknown): Buffer {
  return encodeFrame(Opcode.TEXT, JSON.stringify(json));
}

export function encodePong(payload?: Buffer): Buffer {
  return encodeFrame(Opcode.PONG, payload ?? Buffer.alloc(0));
}

export function encodeClose(code = 1000, reason = ''): Buffer {
  const payload = Buffer.allocUnsafe(2 + Buffer.byteLength(reason));
  payload.writeUInt16BE(code, 0);
  payload.write(reason, 2, 'utf8');
  return encodeFrame(Opcode.CLOSE, payload);
}

// ── Frame Decode ──────────────────────────────────────────────────────────────
//
// Bir Buffer'dan sıfır veya daha fazla tam frame çıkarır.
// Eksik veri durumunda kalan byte'lar döndürülür (TCP stream güvencesi).

export interface DecodeResult {
  frames:    WsFrame[];
  remaining: Buffer;   // bir sonraki çağrıya taşınacak eksik veri
}

export function decodeFrames(buf: Buffer): DecodeResult {
  const frames: WsFrame[] = [];
  let offset = 0;

  while (offset < buf.length) {
    if (buf.length - offset < 2) break;   // en az 2 byte header lazım

    const byte0 = buf[offset];
    const byte1 = buf[offset + 1];

    const fin    = (byte0 & 0x80) !== 0;
    const opcode = (byte0 & 0x0F) as Opcode;
    const masked = (byte1 & 0x80) !== 0;
    let   payloadLen = byte1 & 0x7F;
    let   headerEnd  = offset + 2;

    if (payloadLen === 126) {
      if (buf.length - offset < 4) break;
      payloadLen = buf.readUInt16BE(offset + 2);
      headerEnd  = offset + 4;
    } else if (payloadLen === 127) {
      if (buf.length - offset < 10) break;
      // 64-bit: JavaScript numbers safe to 2^53
      payloadLen = Number(buf.readBigUInt64BE(offset + 2));
      headerEnd  = offset + 10;
    }

    const maskEnd = masked ? headerEnd + 4 : headerEnd;
    if (buf.length < maskEnd + payloadLen) break;  // frame henüz tam gelmedi

    let payload = buf.slice(maskEnd, maskEnd + payloadLen);

    if (masked) {
      const mask = buf.slice(headerEnd, headerEnd + 4);
      payload    = Buffer.from(payload);  // copy — orijinali bozmamak için
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    frames.push({ fin, opcode, masked, payload });
    offset = maskEnd + payloadLen;
  }

  return { frames, remaining: offset > 0 ? buf.slice(offset) : buf };
}
