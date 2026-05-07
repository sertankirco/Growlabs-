import {
  UserId, PlayerId, Player, SlotType,
  SquadEntry, SquadSnapshot,
} from './types';
import {
  SquadNotFoundError,
  SquadCapacityError,
  PlayerAlreadyInSquadError,
  PlayerNotInSquadError,
} from './errors';

export const SQUAD_LIMITS: Record<SlotType, number> = {
  starting: 11,
  bench:     3,
};

interface SquadRecord {
  userId:  UserId;
  entries: SquadEntry[];
  version: number;
}

export class SquadManager {
  private readonly squads = new Map<UserId, SquadRecord>();

  // ── Kadro yönetimi ───────────────────────────────────────────────────────────

  createSquad(userId: UserId): SquadSnapshot {
    if (this.squads.has(userId)) throw new Error(`Kadro zaten var: ${userId}`);
    const record: SquadRecord = { userId, entries: [], version: 0 };
    this.squads.set(userId, record);
    return this.snapshot(record);
  }

  getSquad(userId: UserId): SquadSnapshot {
    return this.snapshot(this.requireSquad(userId));
  }

  // ── Oyuncu ekleme ────────────────────────────────────────────────────────────
  //
  // Kapasiteyi ve tekrar eden oyuncu kontrolünü atomik olarak yapar.
  // SquadManager tek thread'de senkron çalıştığından ayrıca mutex gerekmez;
  // ExchangeEngine'deki WalletEngine rezervasyonu zaten sırayı belirler.

  addPlayer(userId: UserId, player: Player, slot: SlotType): void {
    const squad = this.requireSquad(userId);

    const alreadyIn = squad.entries.some(e => e.player.id === player.id);
    if (alreadyIn) throw new PlayerAlreadyInSquadError(player.id);

    const slotCount = squad.entries.filter(e => e.slot === slot).length;
    if (slotCount >= SQUAD_LIMITS[slot]) {
      throw new SquadCapacityError(slot, SQUAD_LIMITS[slot]);
    }

    squad.entries.push({ player, slot, addedAt: Date.now() });
    squad.version += 1;
  }

  // ── Oyuncu çıkarma ───────────────────────────────────────────────────────────

  removePlayer(userId: UserId, playerId: PlayerId): SquadEntry {
    const squad = this.requireSquad(userId);
    const idx   = squad.entries.findIndex(e => e.player.id === playerId);

    if (idx === -1) throw new PlayerNotInSquadError(playerId);

    const [removed] = squad.entries.splice(idx, 1);
    squad.version += 1;
    return removed;
  }

  // ── Sorgular ─────────────────────────────────────────────────────────────────

  hasPlayer(userId: UserId, playerId: PlayerId): boolean {
    return this.squads.get(userId)?.entries.some(e => e.player.id === playerId) ?? false;
  }

  slotCount(userId: UserId, slot: SlotType): number {
    return this.squads.get(userId)?.entries.filter(e => e.slot === slot).length ?? 0;
  }

  totalCount(userId: UserId): number {
    return this.squads.get(userId)?.entries.length ?? 0;
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private requireSquad(userId: UserId): SquadRecord {
    const s = this.squads.get(userId);
    if (!s) throw new SquadNotFoundError(userId);
    return s;
  }

  private snapshot(r: SquadRecord): SquadSnapshot {
    return { userId: r.userId, entries: [...r.entries], version: r.version };
  }
}
