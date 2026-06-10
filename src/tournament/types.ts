// ── WC2026 Turnuva Tipleri ────────────────────────────────────────────────────

export type GroupId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K' | 'L';

export type KnockoutRound = 'R32' | 'R16' | 'QF' | 'SF' | 'THIRD' | 'FINAL';

export type TournamentPhase = 'PRE_TOURNAMENT' | 'GROUP_STAGE' | 'KNOCKOUT' | 'FINISHED';

// ── Takım ─────────────────────────────────────────────────────────────────────

export interface Team {
  id:      string;   // 'brazil'
  name:    string;   // 'Brezilya'
  flag:    string;   // '🇧🇷'
  groupId: GroupId;
}

// ── Grup Maçı ─────────────────────────────────────────────────────────────────

export interface GroupMatch {
  matchId:   string;
  groupId:   GroupId;
  homeTeam:  string;  // team id
  awayTeam:  string;
  matchday:  1 | 2 | 3;
  kickoffAt: number;  // Unix ms
  homeScore: number | null;
  awayScore: number | null;
  status:    'SCHEDULED' | 'LIVE' | 'FINISHED';
}

// ── Grup Sıralaması ───────────────────────────────────────────────────────────

export interface GroupStanding {
  rank:    number;
  teamId:  string;
  name:    string;
  flag:    string;
  played:  number;
  won:     number;
  drawn:   number;
  lost:    number;
  gf:      number;
  ga:      number;
  gd:      number;
  points:  number;
}

// ── Eleme ─────────────────────────────────────────────────────────────────────

export interface KnockoutMatch {
  matchId:          string;
  round:            KnockoutRound;
  slot:             number;   // 1-16 arası bracket pozisyonu
  homeTeam:         string | null;
  awayTeam:         string | null;
  homeScore:        number | null;
  awayScore:        number | null;
  kickoffAt:        number;
  status:           'PENDING' | 'SCHEDULED' | 'LIVE' | 'FINISHED';
  winnerToMatchId?: string;  // kazanan → sonraki maç
  loserToMatchId?:  string;  // sadece SF → THIRD için
}

// ── Turnuva Snapshot ──────────────────────────────────────────────────────────

export interface TournamentSnapshot {
  phase:     TournamentPhase;
  groups:    Record<GroupId, GroupStanding[]>;
  bracket:   KnockoutMatch[];
  champion:  string | null;
  updatedAt: number;
}
