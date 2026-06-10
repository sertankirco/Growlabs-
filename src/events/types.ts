import { PlayerId, UserId, Position } from '../wallet/types';

// ── Maç Olayı Tipleri ─────────────────────────────────────────────────────────

export type MatchEventType =
  | 'GOAL'
  | 'ASSIST'
  | 'YELLOW_CARD'
  | 'RED_CARD'
  | 'CLEAN_SHEET'       // maç sonu — kaleci/defans
  | 'SAVE_SERIES'       // 3+ kurtarış serisi
  | 'PENALTY_SAVE'
  | 'PENALTY_MISS'
  | 'OWN_GOAL'
  | 'MAN_OF_MATCH';     // maç sonu

export interface MatchEvent {
  eventId:   string;
  matchId:   string;
  playerId:  PlayerId;
  position:  Position;
  type:      MatchEventType;
  minute:    number;       // 1-120
  timestamp: number;
}

// ── Performans Sonuçları ──────────────────────────────────────────────────────

export interface PlayerReward {
  playerId:   PlayerId;
  position:   Position;
  eventType:  MatchEventType;
  coins:      number;       // pozitif = kazanç, negatif = ceza
}

// Bir event'in tüm etkilenen kullanıcılara dağıtılma sonucu
export interface DispatchResult {
  event:           MatchEvent;
  reward:          PlayerReward;
  affectedUsers:   UserId[];
  creditsApplied:  number;   // kaç kullanıcı cüzdanı güncellendi
  priceChange:     number;   // piyasa fiyatı değişimi (coin)
  newMarketPrice:  number;
  durationMs:      number;
}

// ── Maç Durumu ────────────────────────────────────────────────────────────────

export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'HALF_TIME' | 'FINISHED';

export interface MatchState {
  matchId:   string;
  homeTeam:  string;
  awayTeam:  string;
  status:    MatchStatus;
  minute:    number;
  homeScore: number;
  awayScore: number;
  events:    MatchEvent[];
}
