import { Position }           from '../wallet/types';
import { ProviderId }          from './types';
import { WORLD_CUP_PLAYERS }   from '../mock/MatchSimulator';

// ── PlayerRegistry ────────────────────────────────────────────────────────────
//
// Sportradar/Opta'nın kendi ID sistemlerini bizim internal PlayerId'lere çevirir.
//
// Production'da bu veri bir DB tablosunda tutulur ve player-scouting API'lerinden
// otomatik senkronize edilir.  Bu implementasyonda WC2026 kadrosu için hazır
// mapping + runtime kayıt desteği sunulur.

export interface PlayerMeta {
  internalId: string;
  name:       string;
  position:   Position;
}

// Provider-specific ID formatları:
//   Sportradar : "sr:player:840306"
//   Opta       : "p4166"  (eski format) veya "o123456" (yeni)
type ProviderKey = `${ProviderId}:${string}`;

export class PlayerRegistry {
  // internal ID → meta
  private readonly byInternalId = new Map<string, PlayerMeta>();
  // "SPORTRADAR:sr:player:XXX" → internal ID
  private readonly byProviderKey = new Map<ProviderKey, string>();

  constructor() {
    // WC2026 oyuncularını varsayılan olarak kaydet
    for (const p of WORLD_CUP_PLAYERS) {
      this.registerInternal(p.id, p.name, p.position);
    }
    this.loadDefaultMappings();
  }

  // ── Kayıt ─────────────────────────────────────────────────────────────────

  registerInternal(internalId: string, name: string, position: Position): void {
    this.byInternalId.set(internalId, { internalId, name, position });
  }

  registerProviderMapping(
    provider:   ProviderId,
    providerId: string,
    internalId: string,
  ): void {
    const key: ProviderKey = `${provider}:${providerId}`;
    this.byProviderKey.set(key, internalId);
  }

  // ── Çözümleme ─────────────────────────────────────────────────────────────

  resolve(provider: ProviderId, providerId: string): PlayerMeta | undefined {
    const key        = `${provider}:${providerId}` as ProviderKey;
    const internalId = this.byProviderKey.get(key);
    if (!internalId) return undefined;
    return this.byInternalId.get(internalId);
  }

  resolveById(internalId: string): PlayerMeta | undefined {
    return this.byInternalId.get(internalId);
  }

  // Bilinmeyen oyuncu geldiğinde registry'e ekle ve geri dön
  resolveOrRegister(
    provider:   ProviderId,
    providerId: string,
    name:       string,
    position:   Position,
  ): PlayerMeta {
    const existing = this.resolve(provider, providerId);
    if (existing) return existing;

    // Slug oluştur: "Kylian Mbappé" → "kylian-mbappe"
    const internalId = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    this.registerInternal(internalId, name, position);
    this.registerProviderMapping(provider, providerId, internalId);
    return { internalId, name, position };
  }

  getAll(): PlayerMeta[] {
    return [...this.byInternalId.values()];
  }

  // ── Varsayılan eşlemeler (WC2026 kadrosu) ─────────────────────────────────

  private loadDefaultMappings(): void {
    // Sportradar ID → internal
    const srMappings: Array<[string, string]> = [
      ['sr:player:840306', 'mbappe'],
      ['sr:player:1250174','haaland'],
      ['sr:player:1156979','vinicius'],
      ['sr:player:1456604','bellingham'],
      ['sr:player:1099662','pedri'],
      ['sr:player:947700', 'de-bruyne'],
      ['sr:player:1231316','saka'],
      ['sr:player:817767', 'modric'],
      ['sr:player:238223', 'courtois'],
      ['sr:player:817600', 'alisson'],
      ['sr:player:44030',  'van-dijk'],
      ['sr:player:1128428','militao'],
      ['sr:player:1190445','theo'],
      ['sr:player:1253862','osimhen'],
    ];
    for (const [srId, internal] of srMappings) {
      this.registerProviderMapping('SPORTRADAR', srId, internal);
    }

    // Opta ID → internal
    const optaMappings: Array<[string, string]> = [
      ['p4166',   'mbappe'],
      ['p118315', 'haaland'],
      ['p208490', 'vinicius'],
      ['p510316', 'bellingham'],
      ['p470762', 'pedri'],
      ['p90985',  'de-bruyne'],
      ['p491562', 'saka'],
      ['p37157',  'modric'],
      ['p40161',  'courtois'],
      ['p202626', 'alisson'],
      ['p36217',  'van-dijk'],
      ['p452491', 'militao'],
      ['p540079', 'theo'],
      ['p487928', 'osimhen'],
    ];
    for (const [optaId, internal] of optaMappings) {
      this.registerProviderMapping('OPTA', optaId, internal);
    }
  }
}
