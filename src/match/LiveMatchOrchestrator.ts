import { randomUUID }  from 'crypto';
import { EventEmitter } from 'events';
import { IUnifiedPipeline } from '../context/UnifiedContext';
import { MatchState }       from '../events/types';
import {
  buildFinalScenario,
  buildRandomMatch,
  buildTournamentMatch,
  MatchScenario,
} from '../mock/MatchSimulator';
import { Player } from '../wallet/types';

// ── LiveMatchOrchestrator ─────────────────────────────────────────────────────
//
// Tek bir yerden tüm canlı maçları yönetir:
//   - Eş zamanlı birden fazla maç desteği
//   - Dakika bazlı gerçekçi zamanlama (speed=1 → 90sn full match)
//   - Yarı devre / maç sonu otomatik durum geçişleri
//   - Her aşamada EventEmitter ile dış bileşenlere (WsServer) bildirim
//
// Olaylar:
//   'match_upcoming'  — { matchId, homeTeam, awayTeam, startsInMs }
//   'match_kick_off'  — { matchState }
//   'match_half_time' — { matchState }
//   'match_full_time' — { matchState }
//   'match_aborted'   — { matchId }
//   'users_credited'  — { matchId, affectedUsers }

interface RunningMatch {
  scenario:  MatchScenario;
  state:     MatchState;
  abortFlag: boolean;
  startedAt: number;
  speed:     number;
  homePlayerIds: Set<string>;   // gol atarsa home skoru artar
}

export type SimScenario = 'final' | 'random';

export class LiveMatchOrchestrator extends EventEmitter {
  private readonly active = new Map<string, RunningMatch>();

  constructor(private readonly pipeline: IUnifiedPipeline) {
    super();
  }

  // ── Duyuru (maç başlamadan önce) ──────────────────────────────────────────

  announceUpcoming(
    scenarioName: SimScenario,
    startsInMs:   number,
    matchId       = randomUUID(),
  ): string {
    const scenario = scenarioName === 'final'
      ? buildFinalScenario()
      : buildRandomMatch(matchId);

    scenario.matchId = matchId;
    scenario.events.forEach(e => { e.matchId = matchId; });

    this.emit('match_upcoming', {
      matchId,
      homeTeam:   scenario.homeTeam,
      awayTeam:   scenario.awayTeam,
      startsInMs,
    });

    return matchId;
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

    scenario.matchId = matchId;
    scenario.events.forEach(e => { e.matchId = matchId; });

    // Golcülerin yarısı home, yarısı away — deterministik ve basit
    const goalScorers = scenario.events
      .filter(e => e.type === 'GOAL')
      .map(e => e.playerId);
    const homePlayerIds = new Set(goalScorers.slice(0, Math.ceil(goalScorers.length / 2)));

    const state = this.pipeline.startMatch(matchId, scenario.homeTeam, scenario.awayTeam);

    const running: RunningMatch = {
      scenario,
      state:         { ...state },
      abortFlag:     false,
      startedAt:     Date.now(),
      speed,
      homePlayerIds,
    };

    this.active.set(matchId, running);
    this.emit('match_kick_off', { matchState: { ...running.state } });

    this.runLoop(matchId, running).catch(err => {
      console.error(`[Orchestrator] ${matchId} hata:`, err.message);
      this.active.delete(matchId);
    });

    return matchId;
  }

  // ── Turnuva maçı başlat ───────────────────────────────────────────────────
  //
  // Gerçek WC2026 maçı: sadece o takımların oyuncuları event üretir.

  startTournamentMatch(
    tournamentMatchId: string,
    homeTeam:     string,
    awayTeam:     string,
    homePlayers:  Player[],
    awayPlayers:  Player[],
    speed         = 1.0,
  ): string {
    if (this.active.has(tournamentMatchId)) {
      throw new Error(`Maç zaten çalışıyor: ${tournamentMatchId}`);
    }

    const result = buildTournamentMatch(
      tournamentMatchId, homeTeam, awayTeam, homePlayers, awayPlayers,
    );

    result.events.forEach(e => { e.matchId = tournamentMatchId; });

    const state = this.pipeline.startMatch(tournamentMatchId, homeTeam, awayTeam);

    const running: RunningMatch = {
      scenario:      result,
      state:         { ...state },
      abortFlag:     false,
      startedAt:     Date.now(),
      speed,
      homePlayerIds: result.homePlayerIds,
    };

    this.active.set(tournamentMatchId, running);
    this.emit('match_kick_off', { matchState: { ...running.state } });

    this.runLoop(tournamentMatchId, running).catch(err => {
      console.error(`[Orchestrator] ${tournamentMatchId} hata:`, err.message);
      this.active.delete(tournamentMatchId);
    });

    return tournamentMatchId;
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
    const { scenario, speed, homePlayerIds } = running;
    const events = [...scenario.events].sort((a, b) => a.minute - b.minute);

    const msPerMinute = 1000 / speed;

    let halfTimeEmitted = false;
    let lastMinute      = 0;

    for (const event of events) {
      if (running.abortFlag) break;

      const waitMs = (event.minute - lastMinute) * msPerMinute;
      if (waitMs > 0) await sleep(waitMs);
      if (running.abortFlag) break;

      if (!halfTimeEmitted && event.minute > 45) {
        halfTimeEmitted = true;
        running.state.status = 'HALF_TIME';
        running.state.minute = 45;
        this.emit('match_half_time', { matchState: { ...running.state } });
        await sleep(2000 / speed);
        if (running.abortFlag) break;
        running.state.status = 'LIVE';
      }

      const result = await this.pipeline.dispatch(event);

      if (event.type === 'GOAL') {
        if (homePlayerIds.has(event.playerId)) {
          running.state.homeScore++;
        } else {
          running.state.awayScore++;
        }
      }

      running.state.minute = event.minute;
      lastMinute = event.minute;

      if (result.affectedUsers.length > 0) {
        this.emit('users_credited', { matchId, affectedUsers: result.affectedUsers });
      }
    }

    if (!running.abortFlag) {
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
