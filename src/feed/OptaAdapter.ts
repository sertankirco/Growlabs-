import { createHmac } from 'crypto';
import { randomUUID } from 'crypto';
import { MatchEvent }   from '../events/types';
import { IFeedAdapter, OptaF24Feed, OptaEvent, ProviderId } from './types';
import { PlayerRegistry } from './PlayerRegistry';

// ── Opta F24 type_id → internal MatchEventType ────────────────────────────────
// Opta F24 Event Type referansı (kısmi liste, WC2026 ile ilgili olanlar):

const OPTA_TYPE_MAP: Record<string, MatchEvent['type'] | null> = {
  '1':  null,          // pass
  '2':  null,          // offside pass
  '3':  null,          // take on
  '4':  null,          // foul
  '5':  null,          // out
  '6':  null,          // corner awarded
  '7':  null,          // tackle
  '8':  null,          // interception
  '9':  null,          // turnover
  '10': null,          // save
  '11': null,          // claim
  '12': null,          // clearance
  '13': null,          // miss
  '14': null,          // post
  '15': null,          // attempt saved
  '16': 'GOAL',
  '17': null,          // card
  '18': null,          // player off
  '19': null,          // player on
  '20': null,          // player retired
  '21': null,          // player returns
  '22': null,          // player becomes gk
  '23': null,          // deleted event
  '24': null,          // condition change
  '25': null,          // official change
  '27': null,          // start delay
  '28': null,          // end delay
  '30': null,          // end
  '31': 'YELLOW_CARD',
  '32': 'RED_CARD',
  '33': null,          // 2nd yellow
  '34': 'GOAL',        // own goal — qualifier ile ayrışır
  '35': 'YELLOW_CARD', // yellow card retracted (negatif işlem)
  '36': null,          // formation change
  '37': null,          // play resumed
  '38': null,          // tackle last man
  '39': null,          // 50/50
  '40': null,          // keeper pick up
  '41': null,          // chance missed
  '49': null,          // ball recovery
  '50': null,          // blocked pass
  '51': null,          // 16 qualifier
  '52': null,          // recovery
  '54': null,          // clearance off line
  '55': null,          // rescue
  '56': null,          // error leads to goal
  '57': null,          // error leads to attempt
  '58': null,          // key tackle
  '59': null,          // diving save
  '60': null,          // big chance created
  '61': null,          // big chance missed
  '63': 'MAN_OF_MATCH',
  '64': null,          // temp goal
  '65': null,          // last man tackle
  '66': null,          // six yard box clearance
  '67': null,          // keeper sweeper
  '72': 'PENALTY_MISS',
  '73': 'PENALTY_SAVE',
  '74': null,          // clean sheet
  '75': null,          // hat trick
  '80': null,          // goal assist
  '83': 'YELLOW_CARD',
  '84': 'RED_CARD',
  '85': null,          // keeper goal kick
};

// Opta qualifier_id 72 = "Head", 82 = "Own goal"
const OWN_GOAL_QUALIFIER = '82';
const ASSIST_QUALIFIER   = '210'; // "Assist"

export class OptaAdapter implements IFeedAdapter {
  readonly provider: ProviderId = 'OPTA';

  constructor(
    private readonly registry: PlayerRegistry,
    private readonly secret:   string = process.env.OPTA_WEBHOOK_SECRET ?? '',
  ) {}

  // ── Normalize ─────────────────────────────────────────────────────────────

  normalize(raw: unknown, matchId: string): MatchEvent[] {
    const payload = raw as OptaF24Feed;
    if (!payload?.Game?.Event) return [];

    const rawEvents = Array.isArray(payload.Game.Event)
      ? payload.Game.Event
      : [payload.Game.Event];

    const events: MatchEvent[] = [];
    for (const ev of rawEvents) {
      const normalized = this.processOptaEvent(ev, matchId);
      if (normalized) events.push(normalized);
    }
    return events;
  }

  // ── Webhook HMAC-SHA256 doğrulama ─────────────────────────────────────────
  //
  // Opta: Authorization: Bearer <HMAC-SHA256(secret, body)>

  verifySignature(body: Buffer, headers: Record<string, string>): boolean {
    if (!this.secret) return true;
    const auth = headers['authorization'] ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return false;
    const expected = createHmac('sha256', this.secret).update(body).digest('hex');
    return timingSafeEqual(expected, token);
  }

  // ── Özel event işleyicileri ────────────────────────────────────────────────

  private processOptaEvent(ev: OptaEvent, matchId: string): MatchEvent | null {
    const type = OPTA_TYPE_MAP[ev.type_id];
    if (type === null || type === undefined) return null;
    if (!ev.player_id) return null;

    const meta = this.registry.resolve('OPTA', ev.player_id);
    if (!meta) return null;

    // Own goal qualifier kontrolü
    const isOwnGoal = ev.qualifier?.some(q => q.qualifier_id === OWN_GOAL_QUALIFIER);
    const finalType = (ev.type_id === '16' && isOwnGoal) ? 'OWN_GOAL' : type;

    return {
      eventId:   randomUUID(),
      matchId,
      playerId:  meta.internalId,
      position:  meta.position,
      type:      finalType,
      minute:    parseInt(ev.min, 10) || 0,
      timestamp: Date.now(),
    };
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
