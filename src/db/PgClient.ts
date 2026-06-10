import { Socket, connect as netConnect } from 'net';
import { createHash } from 'crypto';

// ── PostgreSQL Wire Protocol v3 İstemcisi ─────────────────────────────────────
//
// Dış bağımlılık yok — yalnızca Node.js 22 built-in modülleri kullanır.
// Desteklenen özellikler:
//   • Trust + MD5 + Cleartext kimlik doğrulama
//   • Simple Query (DDL, DML, parametresiz sorgular)
//   • Extended Query (parameterized — SQL injection riski yok)
//   • BEGIN / COMMIT / ROLLBACK
//
// Protokol referansı: https://www.postgresql.org/docs/current/protocol.html

export interface PgConfig {
  host?:     string;   // varsayılan: 127.0.0.1
  port?:     number;   // varsayılan: 5432
  database:  string;
  user:      string;
  password?: string;
}

export interface QueryResult {
  rows:     Record<string, string | null>[];
  rowCount: number;
  command:  string;
}

export class PgError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'PgError';
  }
}

export class PgClient {
  private sock!:   Socket;
  private buf:     Buffer = Buffer.alloc(0);
  private queue:   Buffer[] = [];
  private waiters: Array<(msg: Buffer) => void> = [];
  private user     = '';
  private closed   = false;
  private notifyHandler?: (channel: string, payload: string) => void;

  // ── Bağlan ────────────────────────────────────────────────────────────────────

  async connect(cfg: PgConfig): Promise<void> {
    this.user = cfg.user;
    const host = cfg.host ?? '127.0.0.1';
    const port = cfg.port ?? 5432;

    this.sock = await new Promise<Socket>((resolve, reject) => {
      const s = netConnect(port, host, () => resolve(s));
      s.once('error', reject);
    });

    this.sock.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });

    this.sock.on('error', (err) => {
      this.closed = true;
      for (const w of this.waiters) w(this.makeErrMsg(err.message));
      this.waiters = [];
    });

    this.sock.on('close', () => {
      this.closed = true;
    });

    // Startup mesajı — type byte YOK (özel durum, diğer mesajlardan farklı)
    const params = `user\0${cfg.user}\0database\0${cfg.database}\0client_encoding\0UTF8\0\0`;
    const paramBuf = Buffer.from(params, 'utf8');
    const startup  = Buffer.alloc(8 + paramBuf.length);
    startup.writeInt32BE(8 + paramBuf.length, 0);
    startup.writeInt32BE(196608, 4); // protokol 3.0
    paramBuf.copy(startup, 8);
    this.sock.write(startup);

    await this.doAuth(cfg.password ?? '');
  }

  // LISTEN modunda gelen NotificationResponse çerçevelerini işler
  setNotifyHandler(fn: (channel: string, payload: string) => void): void {
    this.notifyHandler = fn;
  }

  // ── Çerçeve gönder ────────────────────────────────────────────────────────────

  private send(type: string, body: Buffer): void {
    const frame = Buffer.alloc(5 + body.length);
    frame.write(type, 0, 'ascii');
    frame.writeInt32BE(4 + body.length, 1);
    body.copy(frame, 5);
    this.sock.write(frame);
  }

  // ── Tampon boşalt → mesajları çöz ────────────────────────────────────────────

  private drain(): void {
    while (this.buf.length >= 5) {
      const bodyLen = this.buf.readInt32BE(1); // uzunluk alanı kendisini içerir
      const total   = 1 + bodyLen;             // type byte + length bytes + body
      if (this.buf.length < total) break;
      const msg = Buffer.from(this.buf.subarray(0, total));
      this.buf  = this.buf.subarray(total);

      // 'A' (0x41) = NotificationResponse — asenkron, query döngüsünün dışında
      if (msg[0] === 0x41 && this.notifyHandler) {
        this.parseAndDispatchNotify(msg);
      } else if (this.waiters.length > 0) {
        this.waiters.shift()!(msg);
      } else {
        this.queue.push(msg);
      }
    }
  }

  // NotificationResponse: pid(4) + channel\0 + payload\0
  private parseAndDispatchNotify(msg: Buffer): void {
    const start      = 9;   // 1(type) + 4(len) + 4(pid)
    const chanEnd    = msg.indexOf(0, start);
    if (chanEnd === -1) return;
    const payloadEnd = msg.indexOf(0, chanEnd + 1);
    const channel    = msg.toString('utf8', start, chanEnd);
    const payload    = msg.toString('utf8', chanEnd + 1, payloadEnd === -1 ? undefined : payloadEnd);
    try { this.notifyHandler!(channel, payload); } catch { /* handler hatası WS bağlantısını kesmemeli */ }
  }

  private recv(): Promise<Buffer> {
    return this.queue.length > 0
      ? Promise.resolve(this.queue.shift()!)
      : new Promise(r => this.waiters.push(r));
  }

  // ── Kimlik doğrulama ─────────────────────────────────────────────────────────

  private async doAuth(password: string): Promise<void> {
    while (true) {
      const msg  = await this.recv();
      const type = String.fromCharCode(msg[0]);

      if (type === 'R') {
        const code = msg.readInt32BE(5);
        if (code === 0) continue;        // AuthOk — ReadyForQuery bekle
        if (code === 3) {
          // Cleartext şifre
          this.send('p', Buffer.from(password + '\0', 'utf8'));
        } else if (code === 5) {
          // MD5: md5(md5(password+user) + salt)
          const salt    = msg.subarray(9, 13);
          const md5str  = (s: string)  => createHash('md5').update(s).digest('hex');
          const md5buf  = (b: Buffer)  => createHash('md5').update(b).digest('hex');
          const inner   = md5str(password + this.user);          // hex (32 char)
          const combined = Buffer.concat([Buffer.from(inner, 'ascii'), salt]);
          const outer   = md5buf(combined);
          this.send('p', Buffer.from('md5' + outer + '\0', 'ascii'));
        } else {
          throw new PgError(`Desteklenmeyen auth yöntemi: ${code}`);
        }
      } else if (type === 'Z') {
        return; // ReadyForQuery — bağlantı hazır
      } else if (type === 'E') {
        const { message, code } = this.parseError(msg);
        throw new PgError(`Auth hatası: ${message}`, code);
      }
      // S (ParameterStatus), K (BackendKeyData), N (Notice): sessizce atla
    }
  }

  // ── Sorgu API ────────────────────────────────────────────────────────────────

  async query(sql: string, params: unknown[] = []): Promise<QueryResult> {
    if (this.closed) throw new PgError('Bağlantı kapalı');
    return params.length === 0
      ? this.simpleQuery(sql)
      : this.extendedQuery(sql, params);
  }

  // Simple Query — parametresiz, DDL / DML
  private async simpleQuery(sql: string): Promise<QueryResult> {
    this.send('Q', Buffer.from(sql + '\0', 'utf8'));
    return this.collectResult();
  }

  // Extended Query — parameterized (Parse → Bind → Describe → Execute → Sync)
  private async extendedQuery(sql: string, params: unknown[]): Promise<QueryResult> {
    // Parse: statement-name NUL + SQL NUL + 0 OIDs (sunucu tip çıkarımı)
    const parseName = Buffer.from('\0');
    const sqlBuf    = Buffer.from(sql + '\0', 'utf8');
    const noOids    = Buffer.from([0, 0]);
    this.send('P', Buffer.concat([parseName, sqlBuf, noOids]));

    // Bind: portal NUL + stmt NUL + 0 format codes + N params + 0 result formats
    const portalName  = Buffer.from('\0');
    const stmtName    = Buffer.from('\0');
    const noFmtCodes  = Buffer.from([0, 0]);
    const paramCount  = Buffer.alloc(2);
    paramCount.writeInt16BE(params.length, 0);

    const bindParts: Buffer[] = [portalName, stmtName, noFmtCodes, paramCount];
    for (const p of params) {
      if (p === null || p === undefined) {
        const nullLen = Buffer.alloc(4);
        nullLen.writeInt32BE(-1, 0);
        bindParts.push(nullLen);
      } else {
        const val    = Buffer.from(String(p), 'utf8');
        const lenBuf = Buffer.alloc(4);
        lenBuf.writeInt32BE(val.length, 0);
        bindParts.push(lenBuf, val);
      }
    }
    bindParts.push(Buffer.from([0, 0])); // 0 result format codes (text)
    this.send('B', Buffer.concat(bindParts));

    // Describe portal
    this.send('D', Buffer.from('P\0'));

    // Execute (portal NUL + unlimited rows)
    const execBody = Buffer.concat([Buffer.from('\0'), Buffer.from([0, 0, 0, 0])]);
    this.send('E', execBody);

    // Sync
    this.send('S', Buffer.alloc(0));

    return this.collectExtResult();
  }

  // ── Sonuç toplama — Simple Query ─────────────────────────────────────────────

  private async collectResult(): Promise<QueryResult> {
    let columns: string[]                          = [];
    const rows: Record<string, string | null>[]    = [];
    let command = '';

    while (true) {
      const msg  = await this.recv();
      const type = String.fromCharCode(msg[0]);

      if      (type === 'T') columns = this.parseRowDesc(msg);
      else if (type === 'D') rows.push(this.parseDataRow(msg, columns));
      else if (type === 'C') command = this.parseTag(msg);
      else if (type === 'Z') break;
      else if (type === 'E') { const e = this.parseError(msg); throw new PgError(e.message, e.code); }
      // I (EmptyQueryResponse), N (Notice), S (ParameterStatus): atla
    }

    return { rows, rowCount: rows.length || this.extractRowCount(command), command };
  }

  // ── Sonuç toplama — Extended Query ───────────────────────────────────────────

  private async collectExtResult(): Promise<QueryResult> {
    let columns: string[]                          = [];
    const rows: Record<string, string | null>[]    = [];
    let command = '';

    while (true) {
      const msg  = await this.recv();
      const type = String.fromCharCode(msg[0]);

      if      (type === '1' || type === '2') { /* ParseComplete, BindComplete */ }
      else if (type === 'n' || type === 't') { /* NoData, ParameterDescription */ }
      else if (type === 'T') columns = this.parseRowDesc(msg);
      else if (type === 'D') rows.push(this.parseDataRow(msg, columns));
      else if (type === 'C') command = this.parseTag(msg);
      else if (type === 'Z') break;
      else if (type === 'E') { const e = this.parseError(msg); throw new PgError(e.message, e.code); }
      // N, S: atla
    }

    return { rows, rowCount: rows.length || this.extractRowCount(command), command };
  }

  // ── Mesaj ayrıştırıcılar ──────────────────────────────────────────────────────

  private parseRowDesc(msg: Buffer): string[] {
    const count = msg.readInt16BE(5);
    const cols: string[] = [];
    let offset = 7;
    for (let i = 0; i < count; i++) {
      const end = msg.indexOf(0, offset);
      if (end === -1) break;
      cols.push(msg.toString('utf8', offset, end));
      offset = end + 1 + 18; // NUL + tableOID(4)+colAttr(2)+typeOID(4)+typeSize(2)+typeMod(4)+fmt(2)
    }
    return cols;
  }

  private parseDataRow(msg: Buffer, columns: string[]): Record<string, string | null> {
    const colCount = msg.readInt16BE(5);
    const row: Record<string, string | null> = {};
    let offset = 7;
    for (let i = 0; i < colCount; i++) {
      const len = msg.readInt32BE(offset);
      offset += 4;
      const key = columns[i] ?? `col${i}`;
      if (len === -1) {
        row[key] = null;
      } else {
        row[key] = msg.toString('utf8', offset, offset + len);
        offset  += len;
      }
    }
    return row;
  }

  private parseTag(msg: Buffer): string {
    return msg.toString('utf8', 5, msg.length - 1);
  }

  private parseError(msg: Buffer): { message: string; code?: string } {
    let offset = 5;
    let message = 'Bilinmeyen veritabanı hatası';
    let code: string | undefined;

    while (offset < msg.length - 1) {
      const fieldCode = String.fromCharCode(msg[offset++]);
      if (fieldCode === '\0') break;
      const end = msg.indexOf(0, offset);
      if (end === -1) break;
      const val = msg.toString('utf8', offset, end);
      if (fieldCode === 'M') message = val;
      if (fieldCode === 'C') code    = val;
      offset = end + 1;
    }
    return { message, code };
  }

  private extractRowCount(cmd: string): number {
    const parts = cmd.split(' ');
    const n     = parseInt(parts[parts.length - 1]);
    return isNaN(n) ? 0 : n;
  }

  private makeErrMsg(msg: string): Buffer {
    const body = Buffer.from(`\0M${msg}\0\0`);
    const frame = Buffer.alloc(5 + body.length);
    frame.write('E', 0, 'ascii');
    frame.writeInt32BE(4 + body.length, 1);
    body.copy(frame, 5);
    return frame;
  }

  // ── Transaction yardımcıları ─────────────────────────────────────────────────

  async begin():    Promise<void> { await this.query('BEGIN'); }
  async commit():   Promise<void> { await this.query('COMMIT'); }
  async rollback(): Promise<void> { await this.query('ROLLBACK'); }

  async end(): Promise<void> {
    if (!this.closed) {
      this.closed = true;
      try { this.send('X', Buffer.alloc(0)); } catch { /* socket kapanmış olabilir */ }
      this.sock.destroy();
    }
  }
}
