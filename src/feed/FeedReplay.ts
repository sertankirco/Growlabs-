import { EventEmitter } from 'events';
import { IFeedAdapter, ReplayRecord, ProviderId } from './types';
import { EventPipeline } from '../events/EventPipeline';
import { buildFinalScenario, buildRandomMatch } from '../mock/MatchSimulator';

// ── FeedReplay ────────────────────────────────────────────────────────────────
//
// Geliştirme ve test ortamlarında gerçek bir API anahtarı olmadan
// kayıtlı veya üretilmiş maç verilerini gerçek zamanlı olarak oynatır.
//
// Kullanım:
//   const replay = new FeedReplay(pipeline, adapters);
//   replay.loadScenario('final');          // hazır senaryo
//   await replay.start(1.0);              // 1× gerçek hızda
//   await replay.start(10.0);             // 10× hızlandırılmış
//
// EventEmitter olayları:
//   'event_dispatched'  — her event işlendiğinde
//   'match_finished'    — tüm eventler tamamlandığında
//   'replay_error'      — dispatch hatası

export class FeedReplay extends EventEmitter {
  private record:    ReplayRecord | null = null;
  private running    = false;
  private abortFlag  = false;
  private readonly adapters: Map<ProviderId, IFeedAdapter>;

  constructor(
    private readonly pipeline: EventPipeline,
    adapterList: IFeedAdapter[] = [],
  ) {
    super();
    this.adapters = new Map(adapterList.map(a => [a.provider, a]));
  }

  // ── Senaryo yükleme ───────────────────────────────────────────────────────

  loadScenario(name: 'final' | 'random' | ReplayRecord): void {
    if (typeof name === 'object') {
      this.record = name;
      return;
    }

    const scenario = name === 'final'
      ? buildFinalScenario()
      : buildRandomMatch();

    // Senaryo eventlerini ReplayRecord formatına dönüştür
    const events = scenario.events.map((ev, idx) => ({
      offsetMs: idx * 3000,   // 3 sn aralıklarla simüle et
      provider: 'MOCK' as ProviderId,
      raw:      ev,
    }));

    this.record = {
      matchId:  scenario.matchId,
      homeTeam: scenario.homeTeam,
      awayTeam: scenario.awayTeam,
      kickoff:  new Date().toISOString(),
      events,
    };
  }

  // ── Oynatma ───────────────────────────────────────────────────────────────

  async start(speedMultiplier = 1.0): Promise<void> {
    if (!this.record) throw new Error('Önce loadScenario() çağrılmalı');
    if (this.running) throw new Error('Replay zaten çalışıyor');

    this.running   = true;
    this.abortFlag = false;

    this.pipeline.startMatch(
      this.record.matchId,
      this.record.homeTeam,
      this.record.awayTeam,
    );

    let lastOffset = 0;

    for (const replayEv of this.record.events) {
      if (this.abortFlag) break;

      const delay = (replayEv.offsetMs - lastOffset) / speedMultiplier;
      if (delay > 0) await sleep(delay);
      lastOffset = replayEv.offsetMs;

      try {
        if (replayEv.provider === 'MOCK') {
          // Mock eventler doğrudan dispatch edilir (adapter gerekmez)
          await this.pipeline.dispatch(replayEv.raw as any);
          this.emit('event_dispatched', replayEv.raw);
        } else {
          const adapter = this.adapters.get(replayEv.provider);
          if (!adapter) continue;
          const events = adapter.normalize(replayEv.raw, this.record!.matchId);
          for (const ev of events) {
            if (this.abortFlag) break;
            await this.pipeline.dispatch(ev);
            this.emit('event_dispatched', ev);
          }
        }
      } catch (err) {
        this.emit('replay_error', err);
      }
    }

    this.pipeline.finishMatch(this.record.matchId);
    this.running = false;
    this.emit('match_finished', this.record.matchId);
  }

  stop(): void {
    this.abortFlag = true;
    this.running   = false;
  }

  get isRunning(): boolean { return this.running; }

  // ── Anlık snapshot oynatma (test için) ───────────────────────────────────

  async playAll(speedMultiplier = 100): Promise<number> {
    if (!this.record) throw new Error('Senaryo yüklenmemiş');
    let count = 0;
    for (const replayEv of this.record.events) {
      if (replayEv.provider === 'MOCK') {
        await this.pipeline.dispatch(replayEv.raw as any);
        count++;
      }
    }
    return count;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
