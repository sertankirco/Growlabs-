import { Position } from '../wallet/types';
import { MatchEventType, PlayerReward, MatchEvent } from './types';

// ── Ödül Tablosu — Coin cinsinden ─────────────────────────────────────────────
//
// Tasarım ilkesi: Forvet gol için en yüksek ödülü alır; kaleci temiz kale için
// en yüksek ödülü alır. Ceza kartları tüm pozisyonları eşit etkiler.

type RewardMatrix = Record<MatchEventType, Record<Position, number>>;

const REWARDS: RewardMatrix = {
  GOAL: {
    GK:  50,
    DEF: 100,
    MID: 150,
    FWD: 200,
  },
  ASSIST: {
    GK:  40,
    DEF: 80,
    MID: 100,
    FWD: 80,
  },
  CLEAN_SHEET: {
    GK:  150,
    DEF: 120,
    MID: 30,
    FWD: 0,
  },
  SAVE_SERIES: {
    GK:  80,
    DEF: 0,
    MID: 0,
    FWD: 0,
  },
  PENALTY_SAVE: {
    GK:  150,
    DEF: 0,
    MID: 0,
    FWD: 0,
  },
  YELLOW_CARD: {
    GK:  -30,
    DEF: -30,
    MID: -30,
    FWD: -30,
  },
  RED_CARD: {
    GK:  -100,
    DEF: -100,
    MID: -100,
    FWD: -100,
  },
  OWN_GOAL: {
    GK:  -100,
    DEF: -100,
    MID: -60,
    FWD: -40,
  },
  PENALTY_MISS: {
    GK:  -30,
    DEF: -40,
    MID: -50,
    FWD: -60,
  },
  MAN_OF_MATCH: {
    GK:  100,
    DEF: 100,
    MID: 100,
    FWD: 100,
  },
};

export class PerformanceCalculator {
  calculate(event: MatchEvent): PlayerReward {
    const coins = REWARDS[event.type][event.position];
    return {
      playerId:  event.playerId,
      position:  event.position,
      eventType: event.type,
      coins,
    };
  }

  // Bir maçtaki tüm event'lerin toplam katkısını hesapla
  sumMatch(events: MatchEvent[]): Map<string, number> {
    const totals = new Map<string, number>();
    for (const ev of events) {
      const reward = this.calculate(ev);
      totals.set(ev.playerId, (totals.get(ev.playerId) ?? 0) + reward.coins);
    }
    return totals;
  }

  getRewardTable(): RewardMatrix {
    return REWARDS;
  }
}
