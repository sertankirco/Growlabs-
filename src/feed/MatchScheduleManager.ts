import { EventEmitter }                         from 'events';
import { request as httpsRequest, RequestOptions } from 'https';
import { request as httpRequest }               from 'http';
import { URL }                                  from 'url';
import { EventPipeline }                        from '../events/EventPipeline';
import { LiveFeedClient, FeedEventHandler }     from './LiveFeedClient';

// ── MatchScheduleManager — WC2026 fikstür takibi & otomatik kickoff ───────────
//
// 1. Sportradar turnuva takvim API'sinden WC2026 maçlarını çeker
// 2. Her maç için bir kickoff zamanlayıcısı kurar
// 3. Kickoff gelince:
//    a. 'kickoff' eventi yayınlar → server.ts'deki autoMatchLoop bunu kullanabilir
//    b. LiveFeedClient ile maç canlı akışına abone olur (varsa API anahtarı)
// 4. 5 dakikada bir fikstürü yeniler (erteleme / saat değişikliği için)
//
// Yapılandırma yoksa sessizce simülasyon modunda çalışır.

export interface ScheduledMatch {
  matchId:   string;   // internal ID (srEventId'den türetilir)
  homeTeam:  string;
  awayTeam:  string;
  kickoffAt: number;   // Unix ms
  status:    'SCHEDULED' | 'LIVE' | 'FINISHED';
  srEventId: string;   // "sr:sport_event:12345"
}

export interface ScheduleConfig {
  apiBaseUrl?:        string;   // "https://api.sportradar.com"
  apiKey?:            string;   // SR_API_KEY
  tournamentId?:      string;   // "sr:tournament:40" — FIFA WC2026
  refreshIntervalMs?: number;   // fikstür yenileme sıklığı (default: 5 min)
  feedClient?:        LiveFeedClient;
}

// Olaylar (EventEmitter):
//   'kickoff'            — ScheduledMatch
//   'match_scheduled'    — ScheduledMatch  (yeni eklendi)
//   'match_rescheduled'  — ScheduledMatch  (saat değişti)

export class MatchScheduleManager extends EventEmitter {
  private readonly cfg: Required<Omit<ScheduleConfig, 'feedClient'>> & { feedClient?: LiveFeedClient };
  private readonly schedule  = new Map<string, ScheduledMatch>();
  private readonly timers    = new Map<string, NodeJS.Timeout>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    private readonly pipeline: EventPipeline,
    cfg: ScheduleConfig = {},
  ) {
    super();
    this.cfg = {
      apiBaseUrl:        cfg.apiBaseUrl        ?? '',
      apiKey:            cfg.apiKey            ?? '',
      tournamentId:      cfg.tournamentId      ?? 'sr:tournament:40',
      refreshIntervalMs: cfg.refreshIntervalMs ?? 5 * 60_000,
      feedClient:        cfg.feedClient,
    };
  }

  get isConfigured(): boolean {
    return Boolean(this.cfg.apiKey && this.cfg.apiBaseUrl);
  }

  // ── Başlatma ──────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!this.isConfigured) {
      console.log('[ScheduleMgr] API yapılandırması yok — fikstür çekme devre dışı');
      return;
    }

    await this.refreshSchedule();

    this.refreshTimer = setInterval(
      () => this.refreshSchedule().catch(e =>
        console.error('[ScheduleMgr] Yenileme hatası:', (e as Error).message),
      ),
      this.cfg.refreshIntervalMs,
    );
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    for (const [, t] of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Manuel ekle (test veya admin override) */
  addMatch(match: ScheduledMatch): void {
    this.schedule.set(match.matchId, match);
    this.scheduleKickoff(match);
    this.emit('match_scheduled', match);
  }

  getSchedule(): ScheduledMatch[] {
    return [...this.schedule.values()];
  }

  getUpcoming(withinMs: number): ScheduledMatch[] {
    const cutoff = Date.now() + withinMs;
    return [...this.schedule.values()].filter(
      m => m.status === 'SCHEDULED' && m.kickoffAt <= cutoff,
    );
  }

  // ── Fikstür yenileme ──────────────────────────────────────────────────────

  private async refreshSchedule(): Promise<void> {
    const fixtures = await this.fetchFixtures();
    console.log(`[ScheduleMgr] ${fixtures.length} WC2026 maçı yüklendi`);

    for (const fix of fixtures) {
      const existing = this.schedule.get(fix.matchId);

      if (!existing) {
        this.schedule.set(fix.matchId, fix);
        this.scheduleKickoff(fix);
        this.emit('match_scheduled', fix);
      } else if (existing.status === 'SCHEDULED' && existing.kickoffAt !== fix.kickoffAt) {
        // Saat değişti → zamanlayıcıyı yeniden kur
        const old = this.timers.get(fix.matchId);
        if (old) clearTimeout(old);

        const updated: ScheduledMatch = { ...existing, kickoffAt: fix.kickoffAt };
        this.schedule.set(fix.matchId, updated);
        this.scheduleKickoff(updated);
        this.emit('match_rescheduled', updated);
      }
    }
  }

  private scheduleKickoff(match: ScheduledMatch): void {
    if (match.status !== 'SCHEDULED') return;

    const delay = match.kickoffAt - Date.now();
    if (delay <= 0) return; // zaten başladı

    const mins = Math.round(delay / 60_000);
    console.log(`[ScheduleMgr] Kickoff zamanlayıcısı: ${match.homeTeam} - ${match.awayTeam} (${mins}dk sonra)`);

    const timer = setTimeout(() => {
      this.timers.delete(match.matchId);
      this.onKickoff(match);
    }, delay);

    this.timers.set(match.matchId, timer);
  }

  private onKickoff(match: ScheduledMatch): void {
    if (this.destroyed) return;

    const current = this.schedule.get(match.matchId);
    if (!current || current.status !== 'SCHEDULED') return;

    const live: ScheduledMatch = { ...current, status: 'LIVE' };
    this.schedule.set(match.matchId, live);

    console.log(`[ScheduleMgr] KICKOFF: ${match.homeTeam} - ${match.awayTeam}`);
    this.emit('kickoff', live);

    // Canlı akış başlat (LiveFeedClient + srEventId gerekli)
    if (this.cfg.feedClient && match.srEventId) {
      const handler: FeedEventHandler = async (events, _rawMatchId) => {
        for (const ev of events) {
          try {
            await this.pipeline.dispatch({ ...ev, matchId: match.matchId });
          } catch (err) {
            console.error(`[ScheduleMgr] dispatch hatası: ${(err as Error).message}`);
          }
        }
      };
      this.cfg.feedClient.subscribeMatch(match.srEventId, handler);
    }
  }

  // ── Sportradar Takvim API ─────────────────────────────────────────────────
  //
  // GET /soccer-t3/en/tournaments/{id}/schedule.json?api_key={key}

  private async fetchFixtures(): Promise<ScheduledMatch[]> {
    if (!this.isConfigured) return [];

    const path = `/soccer-t3/en/tournaments/${encodeURIComponent(this.cfg.tournamentId)}/schedule.json?api_key=${this.cfg.apiKey}`;
    const body = await this.fetch(`${this.cfg.apiBaseUrl}${path}`);

    type SrScheduleResponse = {
      sport_events?: Array<{
        id:          string;
        scheduled:   string;
        status?:     string;
        competitors: Array<{ id: string; name: string; qualifier: string }>;
      }>;
    };

    let data: SrScheduleResponse;
    try { data = JSON.parse(body); }
    catch (e) {
      console.error('[ScheduleMgr] Schedule parse hatası:', (e as Error).message);
      return [];
    }

    return (data.sport_events ?? []).map(ev => {
      const home = ev.competitors.find(c => c.qualifier === 'home');
      const away = ev.competitors.find(c => c.qualifier === 'away');
      const srId = ev.id; // "sr:sport_event:12345"

      let status: ScheduledMatch['status'] = 'SCHEDULED';
      if (ev.status === 'live')   status = 'LIVE';
      if (ev.status === 'closed') status = 'FINISHED';

      return {
        matchId:   srId.replace('sr:sport_event:', 'wc2026-'),
        homeTeam:  home?.name ?? 'TBD',
        awayTeam:  away?.name ?? 'TBD',
        kickoffAt: new Date(ev.scheduled).getTime(),
        status,
        srEventId: srId,
      };
    });
  }

  private fetch(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch (e) { reject(e); return; }

      const opts: RequestOptions = {
        hostname: parsed.hostname,
        port:     parsed.port ? parseInt(parsed.port, 10) : (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method:   'GET',
        headers:  { Accept: 'application/json' },
      };

      const reqFn = parsed.protocol === 'https:' ? httpsRequest : (httpRequest as typeof httpsRequest);
      const req = reqFn(opts, (res) => {
        const chunks: Buffer[] = [];
        res.on('data',  c => chunks.push(Buffer.from(c as Buffer)));
        res.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(15_000, () => req.destroy(new Error('Schedule API timeout')));
      req.end();
    });
  }
}
