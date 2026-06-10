import { randomUUID } from 'crypto';
import { Player, Position } from '../wallet/types';
import { MatchEvent, MatchEventType, MatchState } from '../events/types';

// ── Dünya Kupası 2026 Mock Oyuncu Kadrosu ─────────────────────────────────────

export const WORLD_CUP_PLAYERS: Player[] = [
  // Kaleciler
  { id: 'courtois',   name: 'T. Courtois',   position: 'GK',  marketPrice: 1200, performanceScore: 0 },
  { id: 'alisson',    name: 'Alisson',        position: 'GK',  marketPrice: 1100, performanceScore: 0 },
  // Defanslar
  { id: 'van-dijk',   name: 'V. Dijk',        position: 'DEF', marketPrice: 1400, performanceScore: 0 },
  { id: 'militao',    name: 'E. Militao',     position: 'DEF', marketPrice: 1100, performanceScore: 0 },
  { id: 'theo',       name: 'T. Hernandez',   position: 'DEF', marketPrice: 1000, performanceScore: 0 },
  // Orta sahalar
  { id: 'modric',     name: 'L. Modric',      position: 'MID', marketPrice: 1300, performanceScore: 0 },
  { id: 'bellingham', name: 'J. Bellingham',  position: 'MID', marketPrice: 2000, performanceScore: 0 },
  { id: 'pedri',      name: 'Pedri',          position: 'MID', marketPrice: 1800, performanceScore: 0 },
  { id: 'de-bruyne',  name: 'K. De Bruyne',   position: 'MID', marketPrice: 1600, performanceScore: 0 },
  // Forvetsler
  { id: 'mbappe',     name: 'K. Mbappé',      position: 'FWD', marketPrice: 3000, performanceScore: 0 },
  { id: 'haaland',    name: 'E. Haaland',     position: 'FWD', marketPrice: 2800, performanceScore: 0 },
  { id: 'vinicius',   name: 'Vinicius Jr.',   position: 'FWD', marketPrice: 2500, performanceScore: 0 },
  { id: 'saka',       name: 'B. Saka',        position: 'FWD', marketPrice: 1900, performanceScore: 0 },
  { id: 'osimhen',    name: 'V. Osimhen',     position: 'FWD', marketPrice: 1700, performanceScore: 0 },
];

// ── Turnuva maçı: sadece o takımların oyuncularıyla ──────────────────────────
//
// homePlayers / awayPlayers boşsa normal rastgele simülasyona düşer.
// homePlayerIds set olarak döner — orchestrator ev sahibi golcüleri belirler.

export interface TournamentMatchResult extends MatchScenario {
  homePlayerIds: Set<string>;
}

export function buildTournamentMatch(
  matchId:     string,
  homeTeam:    string,
  awayTeam:    string,
  homePlayers: Player[],
  awayPlayers: Player[],
): TournamentMatchResult {
  // Hiç kayıtlı oyuncu yoksa standart rastgele simülasyona dön
  if (homePlayers.length === 0 && awayPlayers.length === 0) {
    const base = buildRandomMatch(matchId, homeTeam, awayTeam);
    const goalScorers = base.events.filter(e => e.type === 'GOAL').map(e => e.playerId);
    return { ...base, homePlayerIds: new Set(goalScorers.slice(0, Math.ceil(goalScorers.length / 2))) };
  }

  const allPlayers = [...homePlayers, ...awayPlayers];
  const fwds       = allPlayers.filter(p => p.position === 'FWD');
  const mids       = allPlayers.filter(p => p.position === 'MID');
  const defs       = allPlayers.filter(p => p.position === 'DEF');
  const gks        = allPlayers.filter(p => p.position === 'GK');

  // Yedek olarak tam havuzu kullan (takımda bu pozisyonda kimse yoksa)
  const allFwds = fwds.length ? fwds : WORLD_CUP_PLAYERS.filter(p => p.position === 'FWD');
  const allMids = mids.length ? mids : WORLD_CUP_PLAYERS.filter(p => p.position === 'MID');
  const allDefs = defs.length ? defs : WORLD_CUP_PLAYERS.filter(p => p.position === 'DEF');
  const allGks  = gks.length  ? gks  : WORLD_CUP_PLAYERS.filter(p => p.position === 'GK');

  const events: MatchEvent[] = [];
  const usedMinutes          = new Set<number>();
  const homeIds              = new Set(homePlayers.map(p => p.id));
  const homePlayerIds        = new Set<string>();

  const goalCount = 2 + Math.floor(Math.random() * 4);

  // Goller — ev/deplasman dengeli dağıt
  for (let i = 0; i < goalCount; i++) {
    const isHome = i % 2 === 0;
    const pool   = isHome ? homePlayers.filter(p => p.position === 'FWD') : awayPlayers.filter(p => p.position === 'FWD');
    const scorer = pick(pool.length ? pool : allFwds);
    const mid    = pick(allMids);
    const minute = uniqueMinute(usedMinutes, 5, 85);

    if (homeIds.has(scorer.id)) homePlayerIds.add(scorer.id);
    events.push(makeEvent(matchId, scorer.id, 'FWD', 'GOAL',   minute));
    events.push(makeEvent(matchId, mid.id,    'MID', 'ASSIST', minute));
  }

  if (Math.random() > 0.4) {
    const carded = pick([...allDefs, ...allMids]);
    events.push(makeEvent(matchId, carded.id, carded.position, 'YELLOW_CARD', uniqueMinute(usedMinutes, 20, 88)));
  }

  if (allGks.length && Math.random() > 0.5) {
    const gk = pick(allGks);
    events.push(makeEvent(matchId, gk.id, 'GK', 'CLEAN_SHEET', 90));
    if (homeIds.has(gk.id)) homePlayerIds.add(gk.id);
  }

  events.push(makeEvent(matchId, pick(allFwds).id, 'FWD', 'MAN_OF_MATCH', 90));
  events.sort((a, b) => a.minute - b.minute);

  return { matchId, homeTeam, awayTeam, events, homePlayerIds };
}

// ── Maç Senaryoları ────────────────────────────────────────────────────────────

export interface MatchScenario {
  matchId:   string;
  homeTeam:  string;
  awayTeam:  string;
  events:    MatchEvent[];
}

// Sabit seed'li deterministik maç senaryosu (test için)
export function buildFinalScenario(): MatchScenario {
  const matchId = 'wc2026-final-fra-bra';

  const events: MatchEvent[] = [
    makeEvent(matchId, 'mbappe',     'FWD', 'GOAL',         18),
    makeEvent(matchId, 'bellingham', 'MID', 'ASSIST',       18),
    makeEvent(matchId, 'vinicius',   'FWD', 'GOAL',         34),
    makeEvent(matchId, 'pedri',      'MID', 'ASSIST',       34),
    makeEvent(matchId, 'militao',    'DEF', 'YELLOW_CARD',  41),
    makeEvent(matchId, 'mbappe',     'FWD', 'GOAL',         67),  // çift gol
    makeEvent(matchId, 'de-bruyne',  'MID', 'YELLOW_CARD',  74),
    makeEvent(matchId, 'haaland',    'FWD', 'GOAL',         82),
    makeEvent(matchId, 'alisson',    'GK',  'SAVE_SERIES',  90),
    makeEvent(matchId, 'courtois',   'GK',  'CLEAN_SHEET',  90),
    makeEvent(matchId, 'van-dijk',   'DEF', 'CLEAN_SHEET',  90),
    makeEvent(matchId, 'mbappe',     'FWD', 'MAN_OF_MATCH', 90),
  ];

  return { matchId, homeTeam: 'Fransa', awayTeam: 'Brezilya', events };
}

// Rastgele ama gerçekçi bir maç üret
export function buildRandomMatch(
  matchId   = randomUUID(),
  homeTeam  = 'Takım A',
  awayTeam  = 'Takım B',
  goalCount = 4,
): MatchScenario {
  const fwds  = WORLD_CUP_PLAYERS.filter(p => p.position === 'FWD');
  const mids  = WORLD_CUP_PLAYERS.filter(p => p.position === 'MID');
  const defs  = WORLD_CUP_PLAYERS.filter(p => p.position === 'DEF');
  const gks   = WORLD_CUP_PLAYERS.filter(p => p.position === 'GK');

  const events: MatchEvent[] = [];
  const usedMinutes = new Set<number>();

  for (let i = 0; i < goalCount; i++) {
    const scorer   = pick(fwds);
    const assister = pick(mids);
    const minute   = uniqueMinute(usedMinutes, 5, 85);
    events.push(makeEvent(matchId, scorer.id,   'FWD', 'GOAL',   minute));
    events.push(makeEvent(matchId, assister.id, 'MID', 'ASSIST', minute));
  }

  // Rastgele kart
  if (Math.random() > 0.4) {
    const carded = pick([...defs, ...mids]);
    events.push(makeEvent(matchId, carded.id, carded.position, 'YELLOW_CARD', uniqueMinute(usedMinutes, 20, 88)));
  }

  // Maç sonu olaylar
  const winner = Math.random() > 0.5 ? pick(gks) : null;
  if (winner) {
    events.push(makeEvent(matchId, winner.id, 'GK', 'CLEAN_SHEET', 90));
    pick(defs.slice(0, 2)) && events.push(makeEvent(matchId, pick(defs).id, 'DEF', 'CLEAN_SHEET', 90));
  }

  events.push(makeEvent(matchId, pick(fwds).id, 'FWD', 'MAN_OF_MATCH', 90));
  events.sort((a, b) => a.minute - b.minute);

  return { matchId, homeTeam, awayTeam, events };
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function makeEvent(
  matchId:  string,
  playerId: string,
  position: Position,
  type:     MatchEventType,
  minute:   number,
): MatchEvent {
  return {
    eventId:   randomUUID(),
    matchId,
    playerId,
    position,
    type,
    minute,
    timestamp: Date.now(),
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uniqueMinute(used: Set<number>, min: number, max: number): number {
  let m: number;
  let tries = 0;
  do { m = Math.floor(Math.random() * (max - min + 1)) + min; tries++; }
  while (used.has(m) && tries < 50);
  used.add(m);
  return m;
}
