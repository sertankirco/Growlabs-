import { EventEmitter }     from 'events';
import {
  GroupId, GroupMatch, GroupStanding, KnockoutMatch,
  KnockoutRound, TournamentPhase, TournamentSnapshot,
} from './types';
import { TEAM_BY_ID, TEAMS_BY_GROUP, buildGroupSchedule } from './WC2026Groups';

// ── TournamentEngine ──────────────────────────────────────────────────────────
//
// WC2026 turnuvasını yönetir:
//   - Grup aşaması maç takvimi (72 maç)
//   - Puan tabloları (galibiyet 3p / beraberlik 1p)
//   - Dereceli üçüncüler belirleme (en iyi 8 üçüncü)
//   - 32'ler eleması bracket oluşturma
//
// Olaylar:
//   'match_result'   — { match: GroupMatch }
//   'group_complete' — { groupId: GroupId, standings: GroupStanding[] }
//   'groups_done'    — {}  (tüm grup maçları bitti)
//   'ko_result'      — { match: KnockoutMatch }
//   'champion'       — { teamId: string }

export class TournamentEngine extends EventEmitter {
  private phase: TournamentPhase = 'PRE_TOURNAMENT';
  private groupMatches = new Map<string, GroupMatch>();   // matchId → match
  private bracket:     KnockoutMatch[] = [];
  private champion:    string | null   = null;

  // matchId → KnockoutMatch lookup
  private bracketMap  = new Map<string, KnockoutMatch>();

  constructor() {
    super();
    this.initGroupStage();
  }

  // ── Başlatma ──────────────────────────────────────────────────────────────

  private initGroupStage(): void {
    const schedule = buildGroupSchedule();
    for (const m of schedule) this.groupMatches.set(m.matchId, m);
    this.phase = 'PRE_TOURNAMENT';
  }

  startGroupStage(): void {
    this.phase = 'GROUP_STAGE';
  }

  // ── Sorgulama ─────────────────────────────────────────────────────────────

  getPhase(): TournamentPhase { return this.phase; }
  getChampion(): string | null { return this.champion; }

  getAllGroupMatches(): GroupMatch[] {
    return [...this.groupMatches.values()].sort((a, b) => a.kickoffAt - b.kickoffAt);
  }

  getGroupMatches(groupId: GroupId): GroupMatch[] {
    return [...this.groupMatches.values()]
      .filter(m => m.groupId === groupId)
      .sort((a, b) => a.kickoffAt - b.kickoffAt);
  }

  getNextScheduledMatches(count = 4): GroupMatch[] {
    const now = Date.now();
    return [...this.groupMatches.values()]
      .filter(m => m.status === 'SCHEDULED' && m.kickoffAt <= now + 48 * 3_600_000)
      .sort((a, b) => a.kickoffAt - b.kickoffAt)
      .slice(0, count);
  }

  getGroupStandings(groupId: GroupId): GroupStanding[] {
    return this.computeStandings(groupId);
  }

  getAllStandings(): Record<GroupId, GroupStanding[]> {
    const result = {} as Record<GroupId, GroupStanding[]>;
    for (const gid of ['A','B','C','D','E','F','G','H','I','J','K','L'] as GroupId[]) {
      result[gid] = this.computeStandings(gid);
    }
    return result;
  }

  getBracket(): KnockoutMatch[] { return [...this.bracket]; }

  getSnapshot(): TournamentSnapshot {
    return {
      phase:     this.phase,
      groups:    this.getAllStandings(),
      bracket:   this.bracket,
      champion:  this.champion,
      updatedAt: Date.now(),
    };
  }

  // ── Sonuç kaydet ──────────────────────────────────────────────────────────

  recordGroupResult(matchId: string, homeScore: number, awayScore: number): void {
    const match = this.groupMatches.get(matchId);
    if (!match || match.status === 'FINISHED') return;

    match.homeScore = homeScore;
    match.awayScore = awayScore;
    match.status    = 'FINISHED';

    this.emit('match_result', { match: { ...match } });

    // Grup tamamlandı mı?
    const groupMatches = this.getGroupMatches(match.groupId);
    if (groupMatches.every(m => m.status === 'FINISHED')) {
      const standings = this.computeStandings(match.groupId);
      this.emit('group_complete', { groupId: match.groupId, standings });

      // Tüm gruplar bitti mi?
      const allDone = [...this.groupMatches.values()].every(m => m.status === 'FINISHED');
      if (allDone) {
        this.emit('groups_done', {});
        this.buildKnockoutBracket();
        this.phase = 'KNOCKOUT';
      }
    }
  }

  recordKnockoutResult(matchId: string, homeScore: number, awayScore: number): void {
    const match = this.bracketMap.get(matchId);
    if (!match || match.status === 'FINISHED') return;

    match.homeScore = homeScore;
    match.awayScore = awayScore;
    match.status    = 'FINISHED';

    const winnerId = homeScore >= awayScore ? match.homeTeam : match.awayTeam;
    const loserId  = homeScore >= awayScore ? match.awayTeam : match.homeTeam;

    // Final → şampiyon
    if (match.round === 'FINAL') {
      this.champion = winnerId;
      this.phase    = 'FINISHED';
      this.emit('champion', { teamId: winnerId });
      return;
    }

    // Kazanan sonraki maça
    if (match.winnerToMatchId) {
      const next = this.bracketMap.get(match.winnerToMatchId);
      if (next) {
        if (!next.homeTeam) next.homeTeam = winnerId;
        else                next.awayTeam  = winnerId;
        next.status = 'SCHEDULED';
      }
    }

    // Kaybeden 3. yer maçına (SF'den)
    if (match.loserToMatchId) {
      const third = this.bracketMap.get(match.loserToMatchId);
      if (third) {
        if (!third.homeTeam) third.homeTeam = loserId;
        else                  third.awayTeam  = loserId;
        third.status = 'SCHEDULED';
      }
    }

    this.emit('ko_result', { match: { ...match } });
  }

  // ── Grup sıralaması hesaplama ─────────────────────────────────────────────
  //
  // Sıralama kriterleri: puan → gol farkı → attıkları gol → kura

  private computeStandings(groupId: GroupId): GroupStanding[] {
    const teams   = TEAMS_BY_GROUP.get(groupId) ?? [];
    const matches = this.getGroupMatches(groupId);

    const map = new Map<string, GroupStanding>();
    for (const t of teams) {
      map.set(t.id, {
        rank: 0, teamId: t.id, name: t.name, flag: t.flag,
        played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0,
      });
    }

    for (const m of matches) {
      if (m.status !== 'FINISHED' || m.homeScore === null || m.awayScore === null) continue;
      const home = map.get(m.homeTeam)!;
      const away = map.get(m.awayTeam)!;
      if (!home || !away) continue;

      home.played++; away.played++;
      home.gf += m.homeScore; home.ga += m.awayScore;
      away.gf += m.awayScore; away.ga += m.homeScore;

      if (m.homeScore > m.awayScore)      { home.won++;   home.points += 3; away.lost++; }
      else if (m.homeScore < m.awayScore) { away.won++;   away.points += 3; home.lost++; }
      else                                 { home.drawn++; home.points++;    away.drawn++; away.points++; }
    }

    for (const s of map.values()) s.gd = s.gf - s.ga;

    const sorted = [...map.values()].sort((a, b) =>
      b.points - a.points || b.gd - a.gd || b.gf - a.gf,
    );

    sorted.forEach((s, i) => { s.rank = i + 1; });
    return sorted;
  }

  // ── Eleme Bracket ─────────────────────────────────────────────────────────
  //
  // 12G kazananı + 12G ikincisi + en iyi 8 üçüncü = 32 takım
  // Bracket: 16 maç R32, 8 maç R16, 4 QF, 2 SF, 1 THIRD, 1 FINAL

  private buildKnockoutBracket(): void {
    const all = this.getAllStandings();
    const winners:   string[] = [];
    const runnersUp: string[] = [];
    const thirds:    { teamId: string; points: number; gd: number; gf: number }[] = [];

    for (const [, st] of Object.entries(all) as [GroupId, GroupStanding[]][]) {
      winners.push(st[0].teamId);
      runnersUp.push(st[1].teamId);
      thirds.push({ teamId: st[2].teamId, points: st[2].points, gd: st[2].gd, gf: st[2].gf });
    }

    thirds.sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
    const bestThirds = thirds.slice(0, 8).map(t => t.teamId);

    // 32 takım: ilk 16 slot = kazananlar + en iyi 4 üçüncü
    //          son 16 slot = ikinciler + en iyi 4 üçüncü (kalan)
    const side1 = [...winners.slice(0, 8),  ...bestThirds.slice(0, 4)];
    const side2 = [...winners.slice(8, 12), ...runnersUp.slice(0, 4), ...runnersUp.slice(4, 8), ...bestThirds.slice(4, 8)];

    const pool32 = [...side1.slice(0,8).map((h,i) => [h, side1[15-i] ?? side2[i]] as [string,string])];
    // Basit bracket oluştur: 32 takımı 16 eşleşmeye diz
    const allTeams32 = [...winners, ...runnersUp, ...bestThirds].slice(0, 32);

    const r32Matches    = this.makeRound('R32', allTeams32, null, 'R32');
    const r16Matches    = this.makeEmptyRound('R16', 8, r32Matches);
    const qfMatches     = this.makeEmptyRound('QF',  4, r16Matches);
    const sfMatches     = this.makeEmptyRound('SF',  2, qfMatches);
    const thirdMatch    = this.makeEmptyMatch('THIRD', 1, '2026-07-26T17:00:00Z');
    const finalMatch    = this.makeEmptyMatch('FINAL', 1, '2026-07-27T20:00:00Z');

    // SF'lerden kaybeden → 3. yer
    for (const sf of sfMatches) sf.loserToMatchId = thirdMatch.matchId;

    // SF'lerden kazanan → final
    for (const sf of sfMatches) sf.winnerToMatchId = finalMatch.matchId;

    this.bracket = [...r32Matches, ...r16Matches, ...qfMatches, ...sfMatches, thirdMatch, finalMatch];
    this.bracketMap.clear();
    for (const m of this.bracket) this.bracketMap.set(m.matchId, m);
  }

  private makeRound(
    round: KnockoutRound,
    teams: string[],
    _parentMatches: KnockoutMatch[] | null,
    _label: string,
  ): KnockoutMatch[] {
    const matchCount = teams.length / 2;
    const startDate  = KNOCKOUT_DATES[round] ?? Date.now();
    const matches: KnockoutMatch[] = [];

    for (let i = 0; i < matchCount; i++) {
      matches.push({
        matchId:   `wc2026-ko-${round.toLowerCase()}-${i + 1}`,
        round,
        slot:      i + 1,
        homeTeam:  teams[i * 2]     ?? null,
        awayTeam:  teams[i * 2 + 1] ?? null,
        homeScore: null,
        awayScore: null,
        kickoffAt: startDate + Math.floor(i / 2) * 86_400_000 + (i % 2) * 3 * 3_600_000,
        status:    'SCHEDULED',
      });
    }
    return matches;
  }

  private makeEmptyRound(round: KnockoutRound, count: number, parentMatches: KnockoutMatch[]): KnockoutMatch[] {
    const startDate = KNOCKOUT_DATES[round] ?? Date.now();
    const matches: KnockoutMatch[] = [];

    for (let i = 0; i < count; i++) {
      const match: KnockoutMatch = {
        matchId:   `wc2026-ko-${round.toLowerCase()}-${i + 1}`,
        round,
        slot:      i + 1,
        homeTeam:  null,
        awayTeam:  null,
        homeScore: null,
        awayScore: null,
        kickoffAt: startDate + Math.floor(i / 2) * 86_400_000 + (i % 2) * 3 * 3_600_000,
        status:    'PENDING',
      };
      matches.push(match);
    }

    // Her iki parent maç bir sonraki maça bağlanır
    for (let i = 0; i < parentMatches.length; i++) {
      parentMatches[i].winnerToMatchId = matches[Math.floor(i / 2)].matchId;
    }

    return matches;
  }

  private makeEmptyMatch(round: KnockoutRound, _count: number, isoDate: string): KnockoutMatch {
    return {
      matchId:   `wc2026-ko-${round.toLowerCase()}-1`,
      round,
      slot:      1,
      homeTeam:  null,
      awayTeam:  null,
      homeScore: null,
      awayScore: null,
      kickoffAt: new Date(isoDate).getTime(),
      status:    'PENDING',
    };
  }
}

// ── Eleme Aşaması Tarih Tablosu ───────────────────────────────────────────────

const KNOCKOUT_DATES: Partial<Record<KnockoutRound, number>> = {
  R32:   new Date('2026-07-05T18:00:00Z').getTime(),
  R16:   new Date('2026-07-12T18:00:00Z').getTime(),
  QF:    new Date('2026-07-18T18:00:00Z').getTime(),
  SF:    new Date('2026-07-22T18:00:00Z').getTime(),
  THIRD: new Date('2026-07-26T17:00:00Z').getTime(),
  FINAL: new Date('2026-07-27T20:00:00Z').getTime(),
};
