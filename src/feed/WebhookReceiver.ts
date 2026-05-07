import { IncomingMessage, ServerResponse } from 'http';
import { IFeedAdapter, WebhookMeta, ProviderId } from './types';
import { EventPipeline }  from '../events/EventPipeline';
import { json }           from '../api/HttpRouter';

// ── Rate Limiter (provider başına) ────────────────────────────────────────────

interface RateWindow {
  count:    number;
  windowStart: number;
}

class RateLimiter {
  private windows = new Map<string, RateWindow>();

  constructor(
    private readonly maxPerMinute: number = 300,
  ) {}

  allow(key: string): boolean {
    const now  = Date.now();
    const win  = this.windows.get(key);
    if (!win || now - win.windowStart > 60_000) {
      this.windows.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (win.count >= this.maxPerMinute) return false;
    win.count++;
    return true;
  }
}

// ── Idempotency kaydı ─────────────────────────────────────────────────────────

class IdempotencyStore {
  private readonly seen = new Map<string, number>(); // eventId → timestamp
  private readonly TTL  = 24 * 60 * 60 * 1000;      // 24 saat

  has(id: string): boolean { return this.seen.has(id); }

  add(id: string): void {
    this.seen.set(id, Date.now());
    this.evict();
  }

  private evict(): void {
    const cutoff = Date.now() - this.TTL;
    for (const [id, ts] of this.seen) {
      if (ts < cutoff) this.seen.delete(id);
    }
  }
}

// ── WebhookReceiver ───────────────────────────────────────────────────────────
//
// Sportradar ve Opta'nın HTTP POST webhook'larını kabul eder:
//   1. Rate limit kontrolü (IP başına dakikada 300 istek)
//   2. HMAC imza doğrulaması (her provider farklı header kullanır)
//   3. Adapter ile normalize et (ham JSON → MatchEvent[])
//   4. Idempotency: daha önce işlenen eventId'ler yeniden işlenmez
//   5. EventPipeline.dispatch() ile sisteme aktar
//   6. WsServer üzerinden abonelere push gönderilir (pipeline emit)

export class WebhookReceiver {
  private readonly adapters    = new Map<ProviderId, IFeedAdapter>();
  private readonly rateLimiter = new RateLimiter();
  private readonly idempotency = new IdempotencyStore();

  constructor(private readonly pipeline: EventPipeline) {}

  // ── Adapter kaydı ─────────────────────────────────────────────────────────

  register(adapter: IFeedAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  // ── Ana HTTP handler ──────────────────────────────────────────────────────
  //
  // POST /feed/webhook/:provider?matchId=xxx
  //
  // Hem Sportradar hem Opta aynı endpoint üzerinden farklı provider
  // parametresiyle ayrışır.

  async handle(
    req:      IncomingMessage,
    res:      ServerResponse,
    provider: ProviderId,
    matchId:  string,
  ): Promise<void> {
    const clientIp = (req.headers['x-forwarded-for'] as string ?? req.socket.remoteAddress ?? 'unknown')
      .split(',')[0].trim();

    // 1. Rate limit
    if (!this.rateLimiter.allow(clientIp)) {
      json(res, 429, { error: 'Rate limit aşıldı — dakikada 300 istek' });
      return;
    }

    // 2. Adapter var mı?
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      json(res, 400, { error: `Bilinmeyen provider: ${provider}` });
      return;
    }

    // 3. Body oku
    const body = await readBody(req);

    // 4. İmza doğrula
    const headers = lowerCaseHeaders(req.headers as Record<string, string>);
    if (!adapter.verifySignature(body, headers)) {
      json(res, 401, { error: 'Geçersiz webhook imzası' });
      return;
    }

    // 5. Normalize
    let raw: unknown;
    try { raw = JSON.parse(body.toString('utf8')); }
    catch { json(res, 400, { error: 'Geçersiz JSON payload' }); return; }

    const events = adapter.normalize(raw, matchId);

    // 6. Idempotency filtresi + dispatch
    let ingested = 0;
    for (const ev of events) {
      if (this.idempotency.has(ev.eventId)) continue;
      this.idempotency.add(ev.eventId);

      try {
        await this.pipeline.dispatch(ev);
        ingested++;
      } catch (err) {
        // Tek bir event hatası tüm batch'i durdurmasın
        console.error(`[WebhookReceiver] dispatch hatası: ${(err as Error).message}`);
      }
    }

    const meta: WebhookMeta = {
      provider,
      receivedAt:     Date.now(),
      matchId,
      eventsIngested: ingested,
      signatureOk:    true,
    };

    json(res, 200, meta);
  }
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data',  c => chunks.push(c));
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function lowerCaseHeaders(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v)]));
}
