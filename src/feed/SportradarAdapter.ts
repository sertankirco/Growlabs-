import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';
import { MatchEvent }    from '../events/types';
import { Position }      from '../wallet/types';
import { IFeedAdapter, SrTimeline, SrTimelineEvent, ProviderId } from './types';
import { PlayerRegistry } from './PlayerRegistry';

// ── Sportradar event tipi → internal MatchEventType eşlemesi ─────────────────

const SR_TYPE_MAP: Record<string, MatchEvent['type'] | null> = {
  score_change:    'GOAL',
  yellow_card:     'YELLOW_CARD',
  red_card:        'RED_CARD',
  yellow_red_card: 'RED_CARD',    // ikinci sarı = kırmızı
  penalty_missed:  'PENALTY_MISS',
  injury_time_shown: null,        // ignore
  period_start:    null,
  period_score:    null,
  match_started:   null,
  match_ended:     null,
};

// Sportradar pozisyon kodu → internal
const SR_POSITION_MAP: Record<string, Position> = {
  G: 'GK', D: 'DEF', M: 'MID', F: 'FWD',
  GK: 'GK', DF: 'DEF', MF: 'MID', FW: 'FWD',
};

export class SportradarAdapter implements IFeedAdapter {
  readonly provider: ProviderId = 'SPORTRADAR';

  constructor(
    private readonly registry: PlayerRegistry,
    private readonly secret:   string = process.env.SR_WEBHOOK_SECRET ?? '',
  ) {}

  // ── Normalize ─────────────────────────────────────────────────────────────
  //
  // Sportradar timeline payload'ını sıfır veya daha fazla MatchEvent'e çevirir.
  // Tanınmayan event tipleri sessizce atlanır (null mapping).
  // Oyuncu kayıtlı değilse resolveOrRegister ile dinamik eklenir.

  normalize(raw: unknown, matchId: string): MatchEvent[] {
    const payload = raw as SrTimeline;
    if (!payload?.timeline) return [];

    const events: MatchEvent[] = [];

    for (const ev of payload.timeline) {
      const eventsFromTl = this.processTimelineEvent(ev, matchId);
      events.push(...eventsFromTl);
    }

    return events;
  }

  // ── Webhook HMAC-SHA256 doğrulama ─────────────────────────────────────────
  //
  // Sportradar: X-SR-API-Signature: hex(HMAC-SHA256(secret, body))

  verifySignature(body: Buffer, headers: Record<string, string>): boolean {
    if (!this.secret) return true;   // sır yoksa dev modunda geç
    const sig      = headers['x-sr-api-signature'] ?? headers['x-sr-api-signature'.toLowerCase()];
    if (!sig) return false;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    // Zamanlamalı saldırılara karşı sabit-zaman karşılaştırma
    return timingSafeEqual(expected, sig);
  }

  // ── Özel event işleyicileri ────────────────────────────────────────────────

  private processTimelineEvent(ev: SrTimelineEvent, matchId: string): MatchEvent[] {
    const results: MatchEvent[] = [];
    const type = SR_TYPE_MAP[ev.type];
    if (type === null || type === undefined) return results; // ignore
    if (!ev.player) return results;

    const meta = this.registry.resolve('SPORTRADAR', ev.player.id);
    if (!meta) return results;  // kayıtlı değil → atla

    const base: MatchEvent = {
      eventId:   randomUUID(),
      matchId,
      playerId:  meta.internalId,
      position:  meta.position,
      type,
      minute:    ev.match_time ?? 0,
      timestamp: Date.now(),
    };

    // Kendi kalesine gol: score_change + method="own_goal"
    if (ev.type === 'score_change' && ev.method === 'own_goal') {
      results.push({ ...base, type: 'OWN_GOAL' });
      return results;
    }

    // Penaltı golü: aynı event hem GOAL hem PENALTY_SAVE değil,
    // method="penalty" ise normal GOL olarak kayıt edilir
    results.push(base);

    // Asist oyuncusu varsa ayrı ASSIST eventi
    if (ev.type === 'score_change' && ev.assist) {
      const assistMeta = this.registry.resolve('SPORTRADAR', ev.assist.id);
      if (assistMeta) {
        results.push({
          eventId:   randomUUID(),
          matchId,
          playerId:  assistMeta.internalId,
          position:  assistMeta.position,
          type:      'ASSIST',
          minute:    ev.match_time ?? 0,
          timestamp: Date.now(),
        });
      }
    }

    return results;
  }
}

// Sabit-zaman string karşılaştırma (timing attack önleme)
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
