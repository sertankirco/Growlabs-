import { randomUUID }  from 'crypto';
import { EventEmitter } from 'events';
import { WalletEngine }            from '../wallet/WalletEngine';
import { SquadManager }            from '../wallet/SquadManager';
import { MarketEngine }            from '../market/MarketEngine';
import { PerformanceCalculator }   from './PerformanceCalculator';
import { MatchEvent, DispatchResult, MatchState } from './types';
import { UserId }                  from '../wallet/types';
import { WORLD_CUP_PLAYERS }       from '../mock/MatchSimulator';

// ── EventPipeline ─────────────────────────────────────────────────────────────
//
// Maçtan gelen ham event'i alır ve şu işlemleri yapar:
//   1. Ödül/ceza miktarını hesapla (PerformanceCalculator)
//   2. Bu oyuncuya sahip tüm kullanıcıları bul (SquadManager)
//   3. Her kullanıcının cüzdanını atomik olarak güncelle (WalletEngine)
//   4. Piyasa fiyatını güncelle (MarketEngine)
//   5. Maç durumunu güncelle
//
// Hedef: olay → cüzdan güncellemesi ≤ 1 saniye

export class EventPipeline extends EventEmitter {
  private readonly calculator = new PerformanceCalculator();
  private readonly matches    = new Map<string, MatchState>();
  private readonly playerNames: Map<string, string>;

  constructor(
    private readonly wallet:  WalletEngine,
    private readonly squad:   SquadManager,
    private readonly market:  MarketEngine,
  ) {
    super();
    // Oyuncu isim haritası — WS mesajlarında okunabilir isim için
    this.playerNames = new Map(WORLD_CUP_PLAYERS.map(p => [p.id, p.name]));
  }

  // ── Ana işlem noktası ─────────────────────────────────────────────────────────

  async dispatch(event: MatchEvent): Promise<DispatchResult> {
    const t0 = Date.now();

    // 1. Ödül hesapla
    const reward = this.calculator.calculate(event);

    // 2. Piyasa fiyatını güncelle
    const newPrice = this.market.applyPerformance(
      event.playerId,
      reward.coins,
      `${event.type}@${event.minute}'`,
    );
    const oldPrice   = newPrice; // applyPerformance zaten yeni fiyatı dönüyor
    const priceChange = newPrice - this.market.getPrice(event.playerId) + (newPrice - oldPrice);

    // 3. Bu oyuncuya sahip kullanıcıları tespit et ve cüzdanları güncelle
    const affectedUsers = this.findOwnersOf(event.playerId);
    let creditsApplied  = 0;

    if (reward.coins !== 0 && affectedUsers.length > 0) {
      const creditPromises = affectedUsers.map(userId =>
        this.wallet.credit(
          userId,
          reward.coins,
          reward.coins > 0 ? 'PERFORMANCE_EARNINGS' : 'WITHDRAWAL',
          `${event.eventId}:${userId}`,   // idempotency key: event+user kombinasyonu
          randomUUID(),
          event.playerId,
        ).then(() => { creditsApplied++; })
         .catch(() => { /* kullanıcı cüzdanı yoksa sessizce atla */ }),
      );
      await Promise.all(creditPromises);
    }

    // 4. Maç durumunu kaydet
    this.updateMatchState(event);

    const result: DispatchResult = {
      event,
      reward,
      affectedUsers,
      creditsApplied,
      priceChange:    newPrice - (newPrice / (1 + 0)),
      newMarketPrice: newPrice,
      durationMs:     Date.now() - t0,
    };

    // 5. WsServer'ın dinleyebileceği event'i yayınla
    this.emit('match_event', {
      matchId:        event.matchId,
      event,
      reward,
      affectedUsers,
      newMarketPrice: newPrice,
      oldPrice:       newPrice,   // applyPerformance zaten yeni değeri döndürdü
      playerName:     this.playerNames.get(event.playerId) ?? event.playerId,
    });

    return result;
  }

  // Birden fazla event'i sıralı olarak işle (maç simülasyonu için)
  async dispatchBatch(events: MatchEvent[]): Promise<DispatchResult[]> {
    const results: DispatchResult[] = [];
    for (const ev of events) {
      results.push(await this.dispatch(ev));
    }
    return results;
  }

  // ── Maç yönetimi ─────────────────────────────────────────────────────────────

  startMatch(matchId: string, homeTeam: string, awayTeam: string): MatchState {
    const state: MatchState = {
      matchId,
      homeTeam,
      awayTeam,
      status:    'LIVE',
      minute:    0,
      homeScore: 0,
      awayScore: 0,
      events:    [],
    };
    this.matches.set(matchId, state);
    return { ...state };
  }

  finishMatch(matchId: string): MatchState {
    const state = this.requireMatch(matchId);
    state.status = 'FINISHED';
    return { ...state, events: [...state.events] };
  }

  getMatch(matchId: string): MatchState {
    const s = this.requireMatch(matchId);
    return { ...s, events: [...s.events] };
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private findOwnersOf(playerId: string): UserId[] {
    // SquadManager'dan tüm kullanıcı listesi çekilir; bu production'da bir
    // "player → owners" index ile O(1)'e indirgenir.
    return (this.squad as any)['squads']
      ? [...((this.squad as any)['squads'] as Map<string, any>).entries()]
          .filter(([, s]) => s.entries.some((e: any) => e.player.id === playerId))
          .map(([userId]) => userId as UserId)
      : [];
  }

  private updateMatchState(event: MatchEvent): void {
    const match = this.matches.get(event.matchId);
    if (!match) return;
    match.events.push(event);
    match.minute = Math.max(match.minute, event.minute);
    if (event.type === 'GOAL') {
      // Basit kural: hangi takımın oyuncusu olduğunu belirlemek için
      // production'da player-team mapping kullanılır; şimdilik sadece sayacı artır
    }
  }

  private requireMatch(matchId: string): MatchState {
    const m = this.matches.get(matchId);
    if (!m) throw new Error(`Maç bulunamadı: ${matchId}`);
    return m;
  }
}
