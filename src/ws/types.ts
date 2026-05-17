import { MatchEvent, PlayerReward } from '../events/types';

// ── Kanal isimleri ─────────────────────────────────────────────────────────────
//
// Abonelik sistemi pub/sub kanalları üzerinden çalışır:
//   "market"           — tüm oyuncu fiyat güncellemeleri
//   "match:<matchId>"  — belirli bir maçın canlı eventleri
//   "wallet:<userId>"  — belirli kullanıcının cüzdan güncellemeleri
//   "leaderboard"      — sıralama değişiklikleri

export type Channel = string;

// ── Sunucu → İstemci Mesajları ────────────────────────────────────────────────

export type ServerMessage =
  | ConnectedMsg
  | WalletUpdateMsg
  | MarketUpdateMsg
  | MatchEventMsg
  | MatchStatusMsg
  | MatchSnapshotMsg
  | MatchUpcomingMsg
  | LeaderboardUpdateMsg
  | SubscribedMsg
  | ErrorMsg
  | PongMsg;

export interface ConnectedMsg {
  type:       'CONNECTED';
  connectionId: string;
  serverTime: number;
  message:    string;
}

export interface WalletUpdateMsg {
  type:      'WALLET_UPDATE';
  userId:    string;
  available: number;
  balance:   number;
  delta:     number;    // bu güncellemedeki coin değişimi
  reason:    string;    // 'GOAL@34 mbappe'
  timestamp: number;
}

export interface MarketUpdateMsg {
  type:      'MARKET_UPDATE';
  playerId:  string;
  name:      string;
  oldPrice:  number;
  newPrice:  number;
  changePct: number;    // yüzde değişim
  trend:     'UP' | 'DOWN' | 'STABLE';
  timestamp: number;
}

export interface MatchEventMsg {
  type:    'MATCH_EVENT';
  matchId: string;
  event:   MatchEvent;
  reward:  PlayerReward;
  timestamp: number;
}

export interface MatchStatusMsg {
  type:      'MATCH_STATUS';
  matchId:   string;
  status:    'KICK_OFF' | 'HALF_TIME' | 'FULL_TIME' | 'ABORTED';
  homeTeam:  string;
  awayTeam:  string;
  homeScore: number;
  awayScore: number;
  minute:    number;
  timestamp: number;
}

// Abonelik sonrası anlık maç durumu — reconnect desteği
export interface MatchSnapshotMsg {
  type:      'MATCH_SNAPSHOT';
  matchId:   string;
  status:    'LIVE' | 'FINISHED' | 'SCHEDULED';
  homeTeam:  string;
  awayTeam:  string;
  homeScore: number;
  awayScore: number;
  minute:    number;
  timestamp: number;
}

export interface MatchUpcomingMsg {
  type:      'MATCH_UPCOMING';
  matchId:   string;
  homeTeam:  string;
  awayTeam:  string;
  startsInMs: number;   // kaç ms sonra başlıyor
  wsChannel: string;    // abone olunacak kanal: "match:<matchId>"
  timestamp: number;
}

export interface LeaderboardUpdateMsg {
  type: 'LEADERBOARD_UPDATE';
  top10: Array<{ rank: number; userId: string; available: number }>;
  timestamp: number;
}

export interface SubscribedMsg {
  type:    'SUBSCRIBED';
  channel: Channel;
}

export interface ErrorMsg {
  type:    'ERROR';
  message: string;
}

export interface PongMsg {
  type:      'PONG';
  timestamp: number;
}

// ── İstemci → Sunucu Mesajları ────────────────────────────────────────────────

export type ClientMessage =
  | { type: 'SUBSCRIBE';   channel: Channel; userId?: string }
  | { type: 'UNSUBSCRIBE'; channel: Channel }
  | { type: 'PING' };
