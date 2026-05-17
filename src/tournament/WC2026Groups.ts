import { GroupId, GroupMatch, Team } from './types';
import { WORLD_CUP_PLAYERS } from '../mock/MatchSimulator';
import { Player } from '../wallet/types';

// ── WC2026 Takımları ──────────────────────────────────────────────────────────

export const WC2026_TEAMS: Team[] = [
  // Grup A
  { id: 'mexico',       name: 'Meksika',           flag: '🇲🇽', groupId: 'A' },
  { id: 'south-africa', name: 'Güney Afrika',       flag: '🇿🇦', groupId: 'A' },
  { id: 'south-korea',  name: 'Güney Kore',         flag: '🇰🇷', groupId: 'A' },
  { id: 'czechia',      name: 'Çekya',              flag: '🇨🇿', groupId: 'A' },
  // Grup B
  { id: 'canada',       name: 'Kanada',             flag: '🇨🇦', groupId: 'B' },
  { id: 'bosnia',       name: 'Bosna-Hersek',       flag: '🇧🇦', groupId: 'B' },
  { id: 'qatar',        name: 'Katar',              flag: '🇶🇦', groupId: 'B' },
  { id: 'switzerland',  name: 'İsviçre',            flag: '🇨🇭', groupId: 'B' },
  // Grup C
  { id: 'brazil',       name: 'Brezilya',           flag: '🇧🇷', groupId: 'C' },
  { id: 'morocco',      name: 'Fas',                flag: '🇲🇦', groupId: 'C' },
  { id: 'haiti',        name: 'Haiti',              flag: '🇭🇹', groupId: 'C' },
  { id: 'scotland',     name: 'İskoçya',            flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', groupId: 'C' },
  // Grup D
  { id: 'usa',          name: 'ABD',                flag: '🇺🇸', groupId: 'D' },
  { id: 'paraguay',     name: 'Paraguay',           flag: '🇵🇾', groupId: 'D' },
  { id: 'australia',    name: 'Avustralya',         flag: '🇦🇺', groupId: 'D' },
  { id: 'turkey',       name: 'Türkiye',            flag: '🇹🇷', groupId: 'D' },
  // Grup E
  { id: 'germany',      name: 'Almanya',            flag: '🇩🇪', groupId: 'E' },
  { id: 'curacao',      name: 'Curaçao',            flag: '🇨🇼', groupId: 'E' },
  { id: 'ivory-coast',  name: 'Fildişi Sahili',     flag: '🇨🇮', groupId: 'E' },
  { id: 'ecuador',      name: 'Ekvador',            flag: '🇪🇨', groupId: 'E' },
  // Grup F
  { id: 'netherlands',  name: 'Hollanda',           flag: '🇳🇱', groupId: 'F' },
  { id: 'japan',        name: 'Japonya',            flag: '🇯🇵', groupId: 'F' },
  { id: 'sweden',       name: 'İsveç',              flag: '🇸🇪', groupId: 'F' },
  { id: 'tunisia',      name: 'Tunus',              flag: '🇹🇳', groupId: 'F' },
  // Grup G
  { id: 'belgium',      name: 'Belçika',            flag: '🇧🇪', groupId: 'G' },
  { id: 'egypt',        name: 'Mısır',              flag: '🇪🇬', groupId: 'G' },
  { id: 'iran',         name: 'İran',               flag: '🇮🇷', groupId: 'G' },
  { id: 'new-zealand',  name: 'Yeni Zelanda',       flag: '🇳🇿', groupId: 'G' },
  // Grup H
  { id: 'spain',        name: 'İspanya',            flag: '🇪🇸', groupId: 'H' },
  { id: 'cape-verde',   name: 'Yeşil Burun Adaları',flag: '🇨🇻', groupId: 'H' },
  { id: 'saudi-arabia', name: 'Suudi Arabistan',    flag: '🇸🇦', groupId: 'H' },
  { id: 'uruguay',      name: 'Uruguay',            flag: '🇺🇾', groupId: 'H' },
  // Grup I
  { id: 'france',       name: 'Fransa',             flag: '🇫🇷', groupId: 'I' },
  { id: 'senegal',      name: 'Senegal',            flag: '🇸🇳', groupId: 'I' },
  { id: 'iraq',         name: 'Irak',               flag: '🇮🇶', groupId: 'I' },
  { id: 'norway',       name: 'Norveç',             flag: '🇳🇴', groupId: 'I' },
  // Grup J
  { id: 'argentina',    name: 'Arjantin',           flag: '🇦🇷', groupId: 'J' },
  { id: 'algeria',      name: 'Cezayir',            flag: '🇩🇿', groupId: 'J' },
  { id: 'austria',      name: 'Avusturya',          flag: '🇦🇹', groupId: 'J' },
  { id: 'jordan',       name: 'Ürdün',              flag: '🇯🇴', groupId: 'J' },
  // Grup K
  { id: 'portugal',     name: 'Portekiz',           flag: '🇵🇹', groupId: 'K' },
  { id: 'dr-congo',     name: 'Kongo DC',           flag: '🇨🇩', groupId: 'K' },
  { id: 'uzbekistan',   name: 'Özbekistan',         flag: '🇺🇿', groupId: 'K' },
  { id: 'colombia',     name: 'Kolombiya',          flag: '🇨🇴', groupId: 'K' },
  // Grup L
  { id: 'england',      name: 'İngiltere',          flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', groupId: 'L' },
  { id: 'croatia',      name: 'Hırvatistan',        flag: '🇭🇷', groupId: 'L' },
  { id: 'ghana',        name: 'Gana',               flag: '🇬🇭', groupId: 'L' },
  { id: 'panama',       name: 'Panama',             flag: '🇵🇦', groupId: 'L' },
];

export const TEAM_BY_ID = new Map<string, Team>(WC2026_TEAMS.map(t => [t.id, t]));

export const TEAMS_BY_GROUP = new Map<GroupId, Team[]>();
for (const t of WC2026_TEAMS) {
  const list = TEAMS_BY_GROUP.get(t.groupId) ?? [];
  list.push(t);
  TEAMS_BY_GROUP.set(t.groupId, list);
}

// ── Oyuncu → Takım Eşlemesi ───────────────────────────────────────────────────
//
// Kadro açıklanmadıysa takımlara yıldız oyuncular atanmaz (null).
// Açıklanınca bu map güncellenir.

export const PLAYER_TEAM: Record<string, string | null> = {
  'mbappe':     'france',
  'theo':       'france',
  'haaland':    'norway',
  'vinicius':   'brazil',
  'alisson':    'brazil',
  'militao':    'brazil',
  'bellingham': 'england',
  'saka':       'england',
  'pedri':      'spain',
  'de-bruyne':  'belgium',
  'courtois':   'belgium',
  'modric':     'croatia',
  'van-dijk':   'netherlands',
  'osimhen':    null,  // Nijerya WC2026'da yok
};

// teamId → Player[] (yıldız oyuncular)
export function getTeamPlayers(teamId: string): Player[] {
  return WORLD_CUP_PLAYERS.filter(p => PLAYER_TEAM[p.id] === teamId);
}

// Maçta yer alan oyuncu havuzu — takımı bilinen oyuncular önce
export function getMatchPlayerPool(homeTeamId: string, awayTeamId: string): {
  homePlayers: Player[];
  awayPlayers: Player[];
} {
  const homePlayers = getTeamPlayers(homeTeamId);
  const awayPlayers = getTeamPlayers(awayTeamId);
  return { homePlayers, awayPlayers };
}

// ── Grup Aşaması Fikstür Üretici ──────────────────────────────────────────────
//
// Her grup için 3 maç günü, toplam 6 maç.
// Eşleşmeler:  MD1: T0vT1, T2vT3 | MD2: T0vT2, T1vT3 | MD3: T0vT3, T1vT2
// MD3 maçları aynı saatte oynanır (müşterek bilgi amaçlı).

const GROUP_MD1_START: Record<GroupId, string> = {
  A: '2026-06-11T18:00:00Z', B: '2026-06-11T21:00:00Z',
  C: '2026-06-12T18:00:00Z', D: '2026-06-12T21:00:00Z',
  E: '2026-06-13T18:00:00Z', F: '2026-06-13T21:00:00Z',
  G: '2026-06-14T18:00:00Z', H: '2026-06-14T21:00:00Z',
  I: '2026-06-15T18:00:00Z', J: '2026-06-15T21:00:00Z',
  K: '2026-06-16T18:00:00Z', L: '2026-06-16T21:00:00Z',
};

const MATCHDAY_OFFSET_DAYS = [0, 7, 14]; // MD1, MD2, MD3 gün farkı

export function buildGroupSchedule(): GroupMatch[] {
  const matches: GroupMatch[] = [];

  for (const [groupId, teams] of TEAMS_BY_GROUP) {
    const [t0, t1, t2, t3] = teams;
    const md1Base = new Date(GROUP_MD1_START[groupId]).getTime();

    const fixtures: [typeof t0, typeof t1, 1 | 2 | 3, number, number][] = [
      // [home, away, matchday, dayOffset, hourOffset]
      [t0, t1, 1, 0,  0],
      [t2, t3, 1, 0,  3 * 3_600_000],
      [t0, t2, 2, 7,  0],
      [t1, t3, 2, 7,  3 * 3_600_000],
      [t0, t3, 3, 14, 0],   // MD3 aynı saatte
      [t1, t2, 3, 14, 0],
    ];

    for (const [home, away, matchday, dayOff, hourOff] of fixtures) {
      matches.push({
        matchId:   `wc2026-${groupId.toLowerCase()}-${home.id}-${away.id}`,
        groupId:   groupId as GroupId,
        homeTeam:  home.id,
        awayTeam:  away.id,
        matchday,
        kickoffAt: md1Base + dayOff * 86_400_000 + hourOff,
        homeScore: null,
        awayScore: null,
        status:    'SCHEDULED',
      });
    }
  }

  return matches.sort((a, b) => a.kickoffAt - b.kickoffAt);
}
