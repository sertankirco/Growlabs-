import { EventEmitter }                        from 'events';
import { request as httpsRequest, RequestOptions } from 'https';
import { request as httpRequest }              from 'http';
import { URL }                                 from 'url';
import { IFeedAdapter }                        from './types';
import { MatchEvent }                          from '../events/types';

// ── LiveFeedClient — Sportradar aktif veri akışı ──────────────────────────────
//
// WebhookReceiver pasif (provider push eder) iken LiveFeedClient aktiftir:
// sunucu, provider API'sine bağlanır ve olayları sürekli çeker.
//
// Öncelik sırası:
//   1. SSE push stream   (SR_PUSH_URL + SR_API_KEY ayarlıysa)
//   2. REST polling       (SR_API_BASE_URL + SR_API_KEY, SSE yoksa)
//   3. Dormant/simulation (API yapılandırması yoksa — geliştirme modu)
//
// Her iki modda da bağlantı kesilmelerinde üstel geri çekilme uygulanır.

export type FeedEventHandler = (events: MatchEvent[], matchId: string) => Promise<void>;

export interface LiveFeedClientConfig {
  pushStreamUrl?:  string;   // HTTPS SSE push endpoint
  restBaseUrl?:    string;   // REST polling base URL
  apiKey?:         string;   // Sportradar API key
  pollIntervalMs?: number;   // polling aralığı (SSE yoksa)
  maxBackoffMs?:   number;   // yeniden bağlanma maks gecikmesi
}

export class LiveFeedClient extends EventEmitter {
  private readonly destroyed     = false as boolean;
  private readonly activeMatches = new Map<string, { unsubscribe: () => void }>();
  private readonly cfg:          Required<LiveFeedClientConfig>;

  constructor(
    private readonly adapter: IFeedAdapter,
    cfg: LiveFeedClientConfig = {},
  ) {
    super();
    this.cfg = {
      pushStreamUrl:  cfg.pushStreamUrl  ?? '',
      restBaseUrl:    cfg.restBaseUrl    ?? '',
      apiKey:         cfg.apiKey         ?? '',
      pollIntervalMs: cfg.pollIntervalMs ?? 10_000,
      maxBackoffMs:   cfg.maxBackoffMs   ?? 30_000,
    };
  }

  get isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && (this.cfg.pushStreamUrl || this.cfg.restBaseUrl));
  }

  // ── Maç aboneliği ─────────────────────────────────────────────────────────

  subscribeMatch(matchId: string, handler: FeedEventHandler): void {
    if ((this as any).destroyed || this.activeMatches.has(matchId)) return;

    if (!this.isConfigured) {
      console.log(`[LiveFeedClient] API yapılandırması yok — ${matchId} simülasyon modunda`);
      this.activeMatches.set(matchId, { unsubscribe: () => {} });
      return;
    }

    if (this.cfg.pushStreamUrl) {
      const { cancel } = this.startSseStream(matchId, handler, 500);
      this.activeMatches.set(matchId, { unsubscribe: cancel });
    } else {
      const { cancel } = this.startPolling(matchId, handler);
      this.activeMatches.set(matchId, { unsubscribe: cancel });
    }

    this.emit('subscribed', matchId);
  }

  unsubscribeMatch(matchId: string): void {
    const sub = this.activeMatches.get(matchId);
    if (!sub) return;
    sub.unsubscribe();
    this.activeMatches.delete(matchId);
    this.emit('unsubscribed', matchId);
  }

  getActiveMatchIds(): string[] {
    return [...this.activeMatches.keys()];
  }

  destroy(): void {
    (this as any).destroyed = true;
    for (const [id] of this.activeMatches) this.unsubscribeMatch(id);
  }

  // ── SSE Akışı ─────────────────────────────────────────────────────────────
  //
  // Sportradar Push Feed: HTTPS chunked SSE (text/event-stream)
  // Format: "data: <JSON>\n\n"  |  heartbeat: "data: heartbeat\n\n"
  // Auth:  ?api_key=<key>  veya  X-Auth-Token header

  private startSseStream(
    matchId:   string,
    handler:   FeedEventHandler,
    backoffMs: number,
  ): { cancel: () => void } {
    let cancelled = false;
    let timer:     NodeJS.Timeout | undefined;
    let req:       ReturnType<typeof httpsRequest> | undefined;

    const connect = () => {
      if (cancelled || (this as any).destroyed) return;

      const url = buildUrl(`${this.cfg.pushStreamUrl}?event_id=${matchId}&api_key=${this.cfg.apiKey}`);
      if (!url) {
        console.error(`[LiveFeedClient] Geçersiz push URL, matchId=${matchId}`);
        return;
      }

      const opts = toRequestOptions(url, {
        Accept:          'text/event-stream',
        'Cache-Control': 'no-cache',
      });

      req = makeRequest(url.protocol, opts, (res) => {
        if (res.statusCode !== 200) {
          console.error(`[LiveFeedClient] SSE ${matchId}: HTTP ${res.statusCode}`);
          res.resume();
          schedule();
          return;
        }

        console.log(`[LiveFeedClient] SSE bağlandı: ${matchId}`);
        this.emit('connected', matchId);
        backoffMs = 500; // bağlantı başarılı → sıfırla

        let buf = '';
        res.setEncoding('utf8');

        res.on('data', (chunk: string) => {
          buf += chunk;
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';

          for (const part of parts) {
            const dataLine = part.split('\n').find(l => l.startsWith('data:'));
            if (!dataLine) continue;
            const json = dataLine.slice(5).trim();
            if (!json || json === 'heartbeat') continue;

            try {
              const events = this.adapter.normalize(JSON.parse(json), matchId);
              if (events.length > 0) {
                handler(events, matchId).catch(e =>
                  console.error(`[LiveFeedClient] handler hatası: ${(e as Error).message}`),
                );
              }
            } catch (e) {
              console.error(`[LiveFeedClient] SSE parse hatası: ${(e as Error).message}`);
            }
          }
        });

        res.on('end',   () => { console.log(`[LiveFeedClient] SSE bitti: ${matchId}`); schedule(); });
        res.on('error', (e) => { console.error(`[LiveFeedClient] SSE akış hatası ${matchId}:`, e.message); schedule(); });
      });

      req.on('error', (e) => {
        if (!cancelled) {
          console.error(`[LiveFeedClient] SSE bağlantı hatası ${matchId}:`, e.message);
          schedule();
        }
      });

      req.setTimeout(90_000, () => { req?.destroy(); schedule(); });
      req.end();
    };

    const schedule = () => {
      if (cancelled) return;
      const delay = backoffMs;
      backoffMs   = Math.min(backoffMs * 2, this.cfg.maxBackoffMs);
      console.log(`[LiveFeedClient] ${matchId} yeniden bağlanma: ${delay}ms`);
      timer = setTimeout(connect, delay);
    };

    connect();

    return {
      cancel: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
        req?.destroy();
      },
    };
  }

  // ── REST Polling ───────────────────────────────────────────────────────────
  //
  // SSE yoksa timeline endpoint'ini N saniyede bir çeker.
  // Görülen eventId'leri takip eder — yeniden işleme yapmaz.

  private startPolling(
    matchId: string,
    handler: FeedEventHandler,
  ): { cancel: () => void } {
    let cancelled = false;
    let timer:     NodeJS.Timeout | undefined;
    const seen = new Set<string>();

    const poll = async () => {
      if (cancelled || (this as any).destroyed) return;

      try {
        const events = await this.fetchTimeline(matchId);
        const fresh  = events.filter(e => !seen.has(e.eventId));
        fresh.forEach(e => seen.add(e.eventId));

        if (fresh.length > 0) {
          await handler(fresh, matchId);
        }
      } catch (e) {
        console.error(`[LiveFeedClient] Poll hatası ${matchId}:`, (e as Error).message);
      }

      if (!cancelled) timer = setTimeout(poll, this.cfg.pollIntervalMs);
    };

    poll();

    return {
      cancel: () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  private fetchTimeline(matchId: string): Promise<MatchEvent[]> {
    return new Promise((resolve, reject) => {
      const rawUrl = `${this.cfg.restBaseUrl}/sport_events/${matchId}/timeline.json?api_key=${this.cfg.apiKey}`;
      const url    = buildUrl(rawUrl);
      if (!url) { reject(new Error(`Geçersiz REST URL: ${rawUrl}`)); return; }

      const req = makeRequest(url.protocol, toRequestOptions(url, {}), (res) => {
        const chunks: Buffer[] = [];
        res.on('data',  c => chunks.push(Buffer.from(c as Buffer)));
        res.on('end',   () => {
          try { resolve(this.adapter.normalize(JSON.parse(Buffer.concat(chunks).toString()), matchId)); }
          catch (e) { reject(e); }
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(15_000, () => req.destroy(new Error('timeout')));
      req.end();
    });
  }
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function buildUrl(raw: string): URL | null {
  try { return new URL(raw); } catch { return null; }
}

function toRequestOptions(url: URL, headers: Record<string, string>): RequestOptions {
  return {
    hostname: url.hostname,
    port:     url.port ? parseInt(url.port, 10) : (url.protocol === 'https:' ? 443 : 80),
    path:     url.pathname + url.search,
    method:   'GET',
    headers,
  };
}

function makeRequest(
  protocol: string,
  opts:     RequestOptions,
  cb:       Parameters<typeof httpsRequest>[1],
): ReturnType<typeof httpsRequest> {
  return protocol === 'https:' ? httpsRequest(opts, cb) : (httpRequest as typeof httpsRequest)(opts, cb);
}
