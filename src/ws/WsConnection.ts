import { Socket } from 'net';
import { randomUUID } from 'crypto';
import {
  decodeFrames, encodeText, encodePong, encodeClose, Opcode,
} from './WsFrame';
import { ServerMessage, ClientMessage, Channel } from './types';

export type MessageHandler = (conn: WsConnection, msg: ClientMessage) => void;
export type CloseHandler   = (conn: WsConnection) => void;

// ── WsConnection ──────────────────────────────────────────────────────────────
//
// Tek bir WebSocket bağlantısını yönetir:
//   - TCP soketi üzerinden raw frame gönderip alır
//   - JSON mesajlarını encode/decode eder
//   - Kanal aboneliklerini tutar
//   - Ping/Pong heartbeat uygular
//   - Temiz kapatma (close frame) sağlar

export class WsConnection {
  readonly id: string = randomUUID();
  private readonly subscriptions = new Set<Channel>();
  private buffer    = Buffer.alloc(0);
  private closed    = false;

  // Bağlantının hangi userId'e ait olduğunu auth sonrası set edilir
  userId?: string;

  constructor(
    private readonly socket:   Socket,
    private readonly onMessage: MessageHandler,
    private readonly onClose:   CloseHandler,
  ) {
    this.socket.on('data',  (chunk: Buffer) => this.onData(chunk));
    this.socket.on('close', ()              => this.handleClose());
    this.socket.on('error', ()              => this.handleClose());
  }

  // ── Abonelik yönetimi ─────────────────────────────────────────────────────────

  subscribe(channel: Channel): void   { this.subscriptions.add(channel); }
  unsubscribe(channel: Channel): void { this.subscriptions.delete(channel); }
  isSubscribed(channel: Channel): boolean { return this.subscriptions.has(channel); }
  getChannels(): Channel[] { return [...this.subscriptions]; }

  // ── Mesaj gönderme ────────────────────────────────────────────────────────────

  send(msg: ServerMessage): boolean {
    if (this.closed || !this.socket.writable) return false;
    try {
      this.socket.write(encodeText(msg));
      return true;
    } catch {
      return false;
    }
  }

  close(code = 1000, reason = 'Normal closure'): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeClose(code, reason));
      this.socket.end();
    } catch { /* soket zaten kapanmış olabilir */ }
  }

  get isAlive(): boolean { return !this.closed && this.socket.writable; }

  // ── Veri akışı ────────────────────────────────────────────────────────────────

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { frames, remaining } = decodeFrames(this.buffer);
    this.buffer = remaining;

    for (const frame of frames) {
      switch (frame.opcode) {
        case Opcode.TEXT:    this.handleText(frame.payload.toString('utf8')); break;
        case Opcode.PING:    this.socket.write(encodePong(frame.payload));    break;
        case Opcode.PONG:    /* heartbeat cevabı */                           break;
        case Opcode.CLOSE:   this.close();                                    break;
        // BINARY ve CONTINUATION desteklenmez — basit mesaj protokolü
      }
    }
  }

  private handleText(raw: string): void {
    let msg: ClientMessage;
    try { msg = JSON.parse(raw); }
    catch { this.send({ type: 'ERROR', message: 'Geçersiz JSON' }); return; }
    this.onMessage(this, msg);
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose(this);
  }
}
