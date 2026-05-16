import { randomUUID }  from 'crypto';
import { EventEmitter } from 'events';
import { IUnifiedPipeline } from '../context/UnifiedContext';
import { MatchState }       from '../events/types';
import {
  buildFinalScenario,
  buildRandomMatch,
  MatchScenario,
} from '../mock/MatchSimulator';

// ── LiveMatchOrchestrator ─────────────────────────────────────────────────────
//
// Tek bir yerden tüm canlı maçları yönetir:
//   - Eş zamanlı birden fazla maç desteği
//   - Dakika bazlı gerçekçi zamanlama (speed=1 → 90sn full match)
//   - Yarı devre / maç sonu otomatik durum geçişleri
//   - Her aşamada EventEmitter ile dış bileşenlere (WsServer) bildirim
//
// Olaylar:
//   'match_kick_off'  — { matchState }
//   'match_half_time' — { matchState }
//   'match_full_time' — { matchState }
//   'match_aborted'   — { matchId }

interface RunningMatch {
  scenario:  MatchScenario;
  state:     MatchState;
  abortFlag: boolean;
  startedAt: number;
  speed:     number;
}

export type SimScenario = 'final' | 'random';

export class LiveMatchOrchestrator extends EventEmitter {
  private readonly active = new Map<string, RunningMatch>();

  constructor(private readonly pipeline: IUnifiedPipeline) {
    super();
  }

  // ── Başlat ────────────────────────────────────────────────────────────────

  startSimulation(
    scenarioName: SimScenario = 'random',
    speed        = 1.0,
    matchId      = randomUUID(),
  ): string {
    if (this.active.has(matchId)) {
      throw new Error(`Maç zaten çalışıyor: ${matchId}`);
    }

    const scenario = scenarioName === 'final'
      ? buildFinalScenario()
      : buildRandomMatch(matchId);

    // Verilen matchId'yi senaryoya uygula
    scenario.matchId = matchId;
    scenario.events.forEach(e => { e.matchId = matchId; });

    const state = this.pipeline.startMatch(matchId, scenario.homeTeam, scenario.awayTeam);

    const running: RunningMatch = {
      scenario,
      state: { ...state },
      abortFlag: false,
      startedAt: Date.now(),
      speed,
    };

    this.active.set(matchId, running);
    this.emit('match_kick_off', { matchState: { ...running.state } });

    // Async oynatım — hataları yakala ama throw etme
    this.runLoop(matchId, running).catch(err => {
      console.error(`[Orchestrator] ${matchId} hata:`, err.message);
      this.active.delete(matchId);
    });

    return matchId;
  }

  // ── Durdur ────────────────────────────────────────────────────────────────

  stopMatch(matchId: string): boolean {
    const running = this.active.get(matchId);
    if (!running) return false;
    running.abortFlag = true;
    this.active.delete(matchId);
    this.emit('match_aborted', { matchId });
    return true;
  }

  // ── Sorgulama ─────────────────────────────────────────────────────────────

  getMatchState(matchId: string): MatchState | null {
    const running = this.active.get(matchId);
    if (running) return { ...running.state };
    try { return this.pipeline.getMatch(matchId); } catch { return null; }
  }

  listActive(): Array<{ matchId: string; state: MatchState; speed: number; elapsedMs: number }> {
    return Array.from(this.active.entries()).map(([matchId, r]) => ({
      matchId,
      state:     { ...r.state },
      speed:     r.speed,
      elapsedMs: Date.now() - r.startedAt,
    }));
  }

  isRunning(matchId: string): boolean {
    return this.active.has(matchId);
  }

  // ── İç döngü ─────────────────────────────────────────────────────────────

  private async runLoop(matchId: string, running: RunningMatch): Promise<void> {
    const { scenario, speed } = running;
    const events = [...scenario.events].sort((a, b) => a.minute - b.minute);

    // Dakika başına milisaniye: speed=1 → 1 dk = 1000ms (90sn full match)
    const msPerMinute = 1000 / speed;

    let halfTimeEmitted = false;
    let lastMinute      = 0;

    for (const event of events) {
      if (running.abortFlag) break;

      // Geçen dakikalar kadar bekle
      const waitMs = (event.minute - lastMinute) * msPerMinute;
      if (waitMs > 0) await sleep(waitMs);
      if (running.abortFlag) break;

      // Yarı devre geçişi
      if (!halfTimeEmitted && event.minute > 45) {
        halfTimeEmitted = true;
        running.state.status = 'HALF_TIME';
        running.state.minute = 45;
        this.emit('match_half_time', { matchState: { ...running.state } });
        await sleep(2000 / speed);   // yarı devre arası
        if (running.abortFlag) break;
        running.state.status = 'LIVE';
      }

      const result = await this.pipeline.dispatch(event);

      // Gol sayısını güncelle (basit kural: ilk 7 oyuncu home, son 7 away)
      if (event.type === 'GOAL') {
        const homePlayerIds = scenario.events
          .filter(e => e.type === 'GOAL')
          .slice(0, Math.ceil(scenario.events.filter(e => e.type === 'GOAL').length / 2))
          .map(e => e.playerId);

        if (homePlayerIds.includes(event.playerId)) {
          running.state.homeScore++;
        } else {
          running.state.awayScore++;
        }
      }

      running.state.minute = event.minute;
      lastMinute = event.minute;

      // Etkilenen kullanıcı varsa leaderboard broadcast öner
      if (result.affectedUsers.length > 0) {
        this.emit('users_credited', { matchId, affectedUsers: result.affectedUsers });
      }
    }

    if (!running.abortFlag) {
      // Maç sonu — 90. dakikaya kadar bekle
      const remainingMs = (90 - lastMinute) * msPerMinute;
      if (remainingMs > 0) await sleep(remainingMs);

      const finalState = this.pipeline.finishMatch(matchId);
      running.state = { ...finalState, ...running.state, status: 'FINISHED', minute: 90 };
      this.emit('match_full_time', { matchState: { ...running.state } });
    }

    this.active.delete(matchId);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
