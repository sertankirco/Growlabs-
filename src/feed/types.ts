import { MatchEvent } from '../events/types';

// ── Provider kimliği ──────────────────────────────────────────────────────────

export type ProviderId = 'SPORTRADAR' | 'OPTA' | 'MOCK';

// ── Ortak normalize arayüzü ───────────────────────────────────────────────────

export interface IFeedAdapter {
  provider: ProviderId;
  /** Ham provider payload'ını MatchEvent dizisine dönüştürür */
  normalize(raw: unknown, matchId: string): MatchEvent[];
  /** Webhook imzasını doğrular (opsiyonel; desteklemiyorsa true döner) */
  verifySignature(body: Buffer, headers: Record<string, string>): boolean;
}

// ── Sportradar ham event yapısı ───────────────────────────────────────────────
// Endpoint: Sport Event Timeline — GET /sport_events/{id}/timeline

export interface SrTimeline {
  sport_event: {
    id:          string;   // "sr:sport_event:12345"
    competitors: SrCompetitor[];
  };
  timeline:    SrTimelineEvent[];
}

export interface SrCompetitor {
  id:         string;
  name:       string;
  qualifier:  'home' | 'away';
  players?:   SrPlayer[];
}

export interface SrPlayer {
  id:       string;   // "sr:player:100"
  name:     string;
  position?: string;  // "G" | "D" | "M" | "F"
}

export interface SrTimelineEvent {
  id:          number;
  type:        string;   // "score_change" | "yellow_card" | "red_card" | ...
  time?:       string;   // "18:00"
  match_time?: number;   // dakika (18)
  player?:     { id: string; name: string };
  assist?:     { id: string; name: string };
  method?:     string;   // "regular" | "penalty" | "own_goal"
  home_score?: number;
  away_score?: number;
  stoppage_time?: number;
}

// ── Opta F24 ham event yapısı ─────────────────────────────────────────────────
// Endpoint: F24 — POST feed (push)

export interface OptaF24Feed {
  Game: {
    id:         string;
    home_team:  string;
    away_team:  string;
    Event:      OptaEvent | OptaEvent[];
  };
}

export interface OptaEvent {
  id:        string;
  event_id:  string;
  type_id:   string;   // "16"=goal, "17"=attemptSaved, "31"=yellowCard, "32"=redCard, etc.
  period_id: string;
  min:       string;
  sec?:      string;
  player_id?: string;
  team_id?:  string;
  outcome?:  string;  // "1"=success
  keypass?:  string;  // "1" if key pass (assist)
  qualifier?: OptaQualifier[];
}

export interface OptaQualifier {
  qualifier_id: string;
  value?:       string;
}

// ── Replay kaydı formatı ──────────────────────────────────────────────────────

export interface ReplayRecord {
  matchId:   string;
  homeTeam:  string;
  awayTeam:  string;
  kickoff:   string;   // ISO 8601
  events:    ReplayEvent[];
}

export interface ReplayEvent {
  offsetMs:  number;   // maç başlangıcından milisaniye
  provider:  ProviderId;
  raw:       unknown;  // orijinal ham payload
}

// ── Webhook meta verisi ───────────────────────────────────────────────────────

export interface WebhookMeta {
  provider:      ProviderId;
  receivedAt:    number;
  matchId:       string;
  eventsIngested: number;
  signatureOk:   boolean;
}
