import { EventEmitter } from 'events';
import { IUnifiedPipeline } from '../context/UnifiedContext';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';

// ── PlayerStatsTracker ────────────────────────────────────────────────────────
//
// Pipeline match_event olaylarını dinleyerek turnuva genelinde oyuncu
// istatistiklerini biriktirir. Sıralama tabloları (gol, asist, temiz kale,
// kazanç) için veri sağlar.
//
// In-memory: sunucu yeniden başlatılınca sıfırlanır.

export interface PlayerStats {
  playerId:       string;
  name:           string;
  position:       string;
  goals:          number;
  assists:        number;
  cleanSheets:    number;
  yellowCards:    number;
  redCards:       number;
  manOfMatch:     number;
  saveSeries:     number;
  penaltySaves:   number;
  ownGoals:       number;
  penaltyMisses:  number;
  totalCoins:     number;    // toplam performans kazancı
  matchesPlayed:  number;    // kaç farklı maçta event aldı
}

export class PlayerStatsTracker extends EventEmitter {
  private readonly stats   = new Map<string, PlayerStats>();
  private readonly matches = new Map<string, Set<string>>();  // playerId → matchId set
  private readonly names   = new Map<string, string>(
    WORLD_CUP_PLAYERS.map(p => [p.id, p.name]),
  );
  private readonly positions = new Map<string, string>(
    WORLD_CUP_PLAYERS.map(p => [p.id, p.position]),
  );

  constructor(pipeline: IUnifiedPipeline) {
    super();
    // Pipeline'dan gelen her match_event'i yakala
    (pipeline as any).on('match_event', (data: any) => {
      this.processEvent(data);
    });
  }

  private processEvent(data: {
    matchId: string;
    event:   any;
    reward:  any;
  }): void {
    const { matchId, event, reward } = data;
    const { playerId, type, position } = event;
    const coins: number = reward?.coins ?? 0;

    const s = this.getOrCreate(playerId, position);

    // Maç takibi
    if (!this.matches.has(playerId)) this.matches.set(playerId, new Set());
    const matchSet = this.matches.get(playerId)!;
    if (!matchSet.has(matchId)) {
      matchSet.add(matchId);
      s.matchesPlayed++;
    }

    // İstatistik güncelleme
    switch (type) {
      case 'GOAL':          s.goals++;          break;
      case 'ASSIST':        s.assists++;        break;
      case 'CLEAN_SHEET':   s.cleanSheets++;    break;
      case 'YELLOW_CARD':   s.yellowCards++;    break;
      case 'RED_CARD':      s.redCards++;       break;
      case 'MAN_OF_MATCH':  s.manOfMatch++;     break;
      case 'SAVE_SERIES':   s.saveSeries++;     break;
      case 'PENALTY_SAVE':  s.penaltySaves++;   break;
      case 'OWN_GOAL':      s.ownGoals++;       break;
      case 'PENALTY_MISS':  s.penaltyMisses++;  break;
    }

    s.totalCoins += coins;

    this.emit('updated', { playerId });
  }

  private getOrCreate(playerId: string, position: string): PlayerStats {
    if (!this.stats.has(playerId)) {
      this.stats.set(playerId, {
        playerId,
        name:          this.names.get(playerId)     ?? playerId,
        position:      this.positions.get(playerId) ?? position,
        goals:         0, assists:       0, cleanSheets:  0,
        yellowCards:   0, redCards:      0, manOfMatch:   0,
        saveSeries:    0, penaltySaves:  0, ownGoals:     0,
        penaltyMisses: 0, totalCoins:   0, matchesPlayed: 0,
      });
    }
    return this.stats.get(playerId)!;
  }

  // ── Sıralama sorguları ────────────────────────────────────────────────────

  getScorers(limit = 10): PlayerStats[] {
    return this.sorted((a, b) =>
      b.goals - a.goals || b.assists - a.assists || b.totalCoins - a.totalCoins,
    ).slice(0, limit);
  }

  getAssisters(limit = 10): PlayerStats[] {
    return this.sorted((a, b) =>
      b.assists - a.assists || b.goals - a.goals || b.totalCoins - a.totalCoins,
    ).slice(0, limit);
  }

  getCleanSheets(limit = 10): PlayerStats[] {
    return this.sorted((a, b) =>
      b.cleanSheets - a.cleanSheets || b.saveSeries - a.saveSeries,
    )
    .filter(s => s.position === 'GK' || s.position === 'DEF')
    .slice(0, limit);
  }

  getTopEarners(limit = 10): PlayerStats[] {
    return this.sorted((a, b) => b.totalCoins - a.totalCoins).slice(0, limit);
  }

  getPlayer(playerId: string): PlayerStats | null {
    return this.stats.get(playerId) ?? null;
  }

  getAll(): PlayerStats[] {
    return this.sorted((a, b) => b.totalCoins - a.totalCoins);
  }

  // ── Genel özet ───────────────────────────────────────────────────────────

  getSummary() {
    return {
      trackedPlayers: this.stats.size,
      totalGoals:     this.sum(s => s.goals),
      totalAssists:   this.sum(s => s.assists),
      totalMatches:   new Set([...this.matches.values()].flatMap(s => [...s])).size,
    };
  }

  private sorted(cmp: (a: PlayerStats, b: PlayerStats) => number): PlayerStats[] {
    return [...this.stats.values()].filter(s => s.matchesPlayed > 0).sort(cmp);
  }

  private sum(fn: (s: PlayerStats) => number): number {
    let total = 0;
    for (const s of this.stats.values()) total += fn(s);
    return total;
  }
}
