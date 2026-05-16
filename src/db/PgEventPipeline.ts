import { EventEmitter } from 'events';
import { randomUUID }   from 'crypto';

import { PgWalletEngine }  from './PgWalletEngine';
import { PgSquadManager }  from './PgSquadManager';
import { PgMarketEngine }  from './PgMarketEngine';
import { PerformanceCalculator } from '../events/PerformanceCalculator';
import { MatchEvent, DispatchResult, MatchState } from '../events/types';
import { UserId } from '../wallet/types';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';

// ── PgEventPipeline ───────────────────────────────────────────────────────────
//
// EventPipeline'ın tam async PostgreSQL versiyonu.
// Temel fark: findOwnersOf() → PgSquadManager.getOwners() (SQL sorgusu)
//             applyPerformance() / getPrice() → await
//
// EventEmitter arayüzü korunur — WsServer doğrudan bu sınıfa bağlanabilir.

export class PgEventPipeline extends EventEmitter {
  private readonly calculator  = new PerformanceCalculator();
  private readonly matches     = new Map<string, MatchState>();
  private readonly playerNames = new Map<string, string>(
    WORLD_CUP_PLAYERS.map(p => [p.id, p.name]),
  );

  constructor(
    private readonly wallet:  PgWalletEngine,
    private readonly squad:   PgSquadManager,
    private readonly market:  PgMarketEngine,
  ) {
    super();
  }

  // ── Ana dispatch ─────────────────────────────────────────────────────────────

  async dispatch(event: MatchEvent): Promise<DispatchResult> {
    const t0 = Date.now();

    // 1. Ödül/ceza hesapla
    const reward = this.calculator.calculate(event);

    // 2. Piyasa fiyatını güncelle (async — DB'ye yazılır)
    const newPrice = await this.market.applyPerformance(
      event.playerId,
      reward.coins,
      `${event.type}@${event.minute}'`,
    );

    // 3. Bu oyuncuya sahip kullanıcıları DB'den bul (SQL: SELECT user_id FROM squad_members)
    const affectedUsers = await this.squad.getOwners(event.playerId);
    let creditsApplied  = 0;

    if (reward.coins !== 0 && affectedUsers.length > 0) {
      await Promise.all(
        affectedUsers.map((userId: UserId) =>
          this.wallet.credit(
            userId,
            reward.coins,
            reward.coins > 0 ? 'PERFORMANCE_EARNINGS' : 'WITHDRAWAL',
            `${event.eventId}:${userId}`,
            randomUUID(),
            event.playerId,
          ).then(() => { creditsApplied++; })
           .catch(() => { /* wallet yoksa atla */ }),
        ),
      );
    }

    // 4. Maç durumu
    this.updateMatchState(event);

    const result: DispatchResult = {
      event,
      reward,
      affectedUsers,
      creditsApplied,
      priceChange:    0,
      newMarketPrice: newPrice,
      durationMs:     Date.now() - t0,
    };

    this.emit('match_event', {
      matchId:        event.matchId,
      event,
      reward,
      affectedUsers,
      newMarketPrice: newPrice,
      oldPrice:       newPrice,
      playerName:     this.playerNames.get(event.playerId) ?? event.playerId,
    });

    return result;
  }

  async dispatchBatch(events: MatchEvent[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const ev of events) results.push(await this.dispatch(ev));
    return results;
  }

  // ── Maç yönetimi ─────────────────────────────────────────────────────────────

  startMatch(matchId: string, homeTeam: string, awayTeam: string): MatchState {
    const state: MatchState = {
      matchId, homeTeam, awayTeam,
      status: 'LIVE', minute: 0, homeScore: 0, awayScore: 0, events: [],
    };
    this.matches.set(matchId, state);
    return { ...state };
  }

  finishMatch(matchId: string): MatchState {
    const s = this.requireMatch(matchId);
    s.status = 'FINISHED';
    return { ...s, events: [...s.events] };
  }

  getMatch(matchId: string): MatchState {
    const s = this.requireMatch(matchId);
    return { ...s, events: [...s.events] };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private updateMatchState(event: MatchEvent): void {
    const m = this.matches.get(event.matchId);
    if (!m) return;
    m.events.push(event);
    m.minute = Math.max(m.minute, event.minute);
  }

  private requireMatch(matchId: string): MatchState {
    const m = this.matches.get(matchId);
    if (!m) throw new Error(`Maç bulunamadı: ${matchId}`);
    return m;
  }
}
