import { PgPool } from './PgPool';
import { UserId, PlayerId, Player, SlotType, SquadEntry, SquadSnapshot, Position } from '../wallet/types';
import {
  SquadNotFoundError,
  SquadCapacityError,
  PlayerAlreadyInSquadError,
  PlayerNotInSquadError,
} from '../wallet/errors';
import { SQUAD_LIMITS } from '../wallet/SquadManager';

// ── PgSquadManager ────────────────────────────────────────────────────────────
//
// SquadManager'ın PostgreSQL-backed versiyonu.
// • squad_versions satırı üzerinde SELECT FOR UPDATE → kadro değişikliklerini serialize eder
// • Kapasite kontrolü SELECT COUNT ile yapılır (veritabanı tutarlılığı)

export class PgSquadManager {
  constructor(private readonly pool: PgPool) {}

  // ── Kadro oluştur ─────────────────────────────────────────────────────────────

  async createSquad(userId: UserId): Promise<void> {
    await this.pool.query(
      'INSERT INTO squad_versions (user_id, version) VALUES ($1, 0) ON CONFLICT DO NOTHING',
      [userId],
    );
  }

  // ── Kadro görüntüle ───────────────────────────────────────────────────────────

  async getSquad(userId: UserId): Promise<SquadSnapshot> {
    // Önce version kontrolü
    const vr = await this.pool.query(
      'SELECT version FROM squad_versions WHERE user_id = $1',
      [userId],
    );
    if (vr.rows.length === 0) throw new SquadNotFoundError(userId);

    const mr = await this.pool.query(
      `SELECT sm.player_id, sm.slot, sm.added_at,
              p.name, p.position, p.base_market_price, p.perf_score
       FROM squad_members sm
       JOIN players p ON p.player_id = sm.player_id
       WHERE sm.user_id = $1
       ORDER BY sm.added_at`,
      [userId],
    );

    const entries: SquadEntry[] = mr.rows.map(row => ({
      player: {
        id:               row.player_id!,
        name:             row.name!,
        position:         row.position! as Position,
        marketPrice:      parseInt(row.base_market_price ?? '0'),
        performanceScore: parseInt(row.perf_score ?? '0'),
      },
      slot:    row.slot! as SlotType,
      addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
    }));

    return {
      userId,
      entries,
      version: parseInt(vr.rows[0].version ?? '0'),
    };
  }

  // ── Oyuncu ekle ───────────────────────────────────────────────────────────────

  async addPlayer(userId: UserId, player: Player, slot: SlotType): Promise<void> {
    await this.pool.withTransaction(async (client) => {
      // Kadro satırı kilidi
      const vr = await client.query(
        'SELECT version FROM squad_versions WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      if (vr.rows.length === 0) throw new SquadNotFoundError(userId);

      // Tekrarlayan oyuncu kontrolü
      const dup = await client.query(
        'SELECT 1 FROM squad_members WHERE user_id = $1 AND player_id = $2',
        [userId, player.id],
      );
      if (dup.rows.length > 0) throw new PlayerAlreadyInSquadError(player.id);

      // Kapasite kontrolü
      const cnt = await client.query(
        'SELECT COUNT(*) AS c FROM squad_members WHERE user_id = $1 AND slot = $2',
        [userId, slot],
      );
      if (parseInt(cnt.rows[0].c ?? '0') >= SQUAD_LIMITS[slot]) {
        throw new SquadCapacityError(slot, SQUAD_LIMITS[slot]);
      }

      // Oyuncu bilgisini players tablosuna kaydet (upsert)
      await client.query(
        `INSERT INTO players (player_id, name, position, base_market_price, perf_score)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_id) DO UPDATE SET name = EXCLUDED.name`,
        [player.id, player.name, player.position, player.marketPrice, player.performanceScore],
      );

      await client.query(
        'INSERT INTO squad_members (user_id, player_id, slot) VALUES ($1, $2, $3)',
        [userId, player.id, slot],
      );

      await client.query(
        'UPDATE squad_versions SET version = version + 1 WHERE user_id = $1',
        [userId],
      );
    });
  }

  // ── Oyuncu çıkar ──────────────────────────────────────────────────────────────

  async removePlayer(userId: UserId, playerId: PlayerId): Promise<SquadEntry> {
    return this.pool.withTransaction(async (client) => {
      const vr = await client.query(
        'SELECT version FROM squad_versions WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      if (vr.rows.length === 0) throw new SquadNotFoundError(userId);

      const mr = await client.query(
        `SELECT sm.slot, sm.added_at,
                p.name, p.position, p.base_market_price, p.perf_score
         FROM squad_members sm
         JOIN players p ON p.player_id = sm.player_id
         WHERE sm.user_id = $1 AND sm.player_id = $2`,
        [userId, playerId],
      );
      if (mr.rows.length === 0) throw new PlayerNotInSquadError(playerId);

      await client.query(
        'DELETE FROM squad_members WHERE user_id = $1 AND player_id = $2',
        [userId, playerId],
      );
      await client.query(
        'UPDATE squad_versions SET version = version + 1 WHERE user_id = $1',
        [userId],
      );

      const row = mr.rows[0];
      return {
        player: {
          id:               playerId,
          name:             row.name!,
          position:         row.position! as Position,
          marketPrice:      parseInt(row.base_market_price ?? '0'),
          performanceScore: parseInt(row.perf_score ?? '0'),
        },
        slot:    row.slot! as SlotType,
        addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
      };
    });
  }

  // ── Sorgular ──────────────────────────────────────────────────────────────────

  // Bir oyuncuya sahip tüm kullanıcıları döner (EventPipeline fan-out için)
  async getOwners(playerId: PlayerId): Promise<UserId[]> {
    const r = await this.pool.query(
      'SELECT user_id FROM squad_members WHERE player_id = $1',
      [playerId],
    );
    return r.rows.map(row => row.user_id!);
  }

  async hasPlayer(userId: UserId, playerId: PlayerId): Promise<boolean> {
    const r = await this.pool.query(
      'SELECT 1 FROM squad_members WHERE user_id = $1 AND player_id = $2',
      [userId, playerId],
    );
    return r.rows.length > 0;
  }

  async slotCount(userId: UserId, slot: SlotType): Promise<number> {
    const r = await this.pool.query(
      'SELECT COUNT(*) AS c FROM squad_members WHERE user_id = $1 AND slot = $2',
      [userId, slot],
    );
    return parseInt(r.rows[0]?.c ?? '0');
  }

  async totalCount(userId: UserId): Promise<number> {
    const r = await this.pool.query(
      'SELECT COUNT(*) AS c FROM squad_members WHERE user_id = $1',
      [userId],
    );
    return parseInt(r.rows[0]?.c ?? '0');
  }
}
