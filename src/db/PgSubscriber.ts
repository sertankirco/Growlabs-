import { EventEmitter } from 'events';
import { PgClient, PgConfig } from './PgClient';

// ── PgSubscriber ──────────────────────────────────────────────────────────────
//
// PostgreSQL LISTEN modunda çalışan kalıcı bağlantı.
// Herhangi bir process pg_notify() çağırdığında, tüm LISTEN bağlantıları
// NotificationResponse alır. Bu sayede birden fazla Node.js instance
// aynı olayları işleyip kendi WS istemcilerine iletebilir.
//
// Kullanım:
//   const sub = new PgSubscriber();
//   await sub.start(dbConfig, ['wc2026_events']);
//   sub.on('wc2026_events', (data) => { wsServer.broadcast(..., data); });
//
// Kanal adı PostgreSQL identifier kurallarına uymalı (tırnak gerekmez).

export class PgSubscriber extends EventEmitter {
  private client?: PgClient;
  private cfg!: PgConfig;
  private channels: string[] = [];

  async start(cfg: PgConfig, channels: string[]): Promise<void> {
    this.cfg      = cfg;
    this.channels = channels;

    this.client = new PgClient();
    await this.client.connect(cfg);

    // NotificationResponse ('A') çerçeveleri asenkron gelir — handler kaydet
    this.client.setNotifyHandler((channel, rawPayload) => {
      let parsed: unknown = rawPayload;
      try { parsed = JSON.parse(rawPayload); } catch { /* metin payload */ }
      this.emit(channel, parsed);
    });

    // Tüm kanallara abone ol
    for (const ch of channels) {
      await this.client.query(`LISTEN ${ch}`);
    }
  }

  async stop(): Promise<void> {
    await this.client?.end();
  }
}
