import { randomUUID } from 'crypto';
import { PgPool, PgClient } from './PgPool';
import { UserId, TxId, TxType, Transaction, WalletSnapshot } from '../wallet/types';
import {
  InsufficientFundsError,
  TransactionNotFoundError,
  InvalidTransactionStateError,
  WalletNotFoundError,
} from '../wallet/errors';
import { PgError } from './PgClient';

// ── PgWalletEngine ────────────────────────────────────────────────────────────
//
// WalletEngine'in PostgreSQL-backed versiyonu.
// Çift harcama önleme: in-memory mutex YERİNE → SELECT ... FOR UPDATE
//
// SELECT FOR UPDATE, veritabanı seviyesinde satır kilidi koyar.
// Aynı kullanıcı için iki eşzamanlı reserveFunds çağrısı yaparsa,
// ikincisi birincisi COMMIT/ROLLBACK yapana kadar BLOKLANIR.
// Bu, tek sunucu sınırını aşan yatay ölçekleme için de geçerlidir.

export class PgWalletEngine {
  constructor(private readonly pool: PgPool) {}

  // ── Cüzdan yönetimi ─────────────────────────────────────────────────────────

  async createWallet(userId: UserId, initialBalance = 0): Promise<WalletSnapshot> {
    try {
      const r = await this.pool.query(
        `INSERT INTO wallets (user_id, balance, reserved, version)
         VALUES ($1, $2, 0, 0) RETURNING *`,
        [userId, initialBalance],
      );
      return this.rowToSnapshot(r.rows[0]);
    } catch (err) {
      if (err instanceof PgError && err.code === '23505') {
        throw new Error(`Cüzdan zaten var: ${userId}`);
      }
      throw err;
    }
  }

  async getWallet(userId: UserId): Promise<WalletSnapshot> {
    const r = await this.pool.query(
      'SELECT * FROM wallets WHERE user_id = $1',
      [userId],
    );
    if (r.rows.length === 0) throw new WalletNotFoundError(userId);
    return this.rowToSnapshot(r.rows[0]);
  }

  async getAvailable(userId: UserId): Promise<number> {
    const r = await this.pool.query(
      'SELECT balance - reserved AS available FROM wallets WHERE user_id = $1',
      [userId],
    );
    if (r.rows.length === 0) throw new WalletNotFoundError(userId);
    return parseInt(r.rows[0].available ?? '0');
  }

  // ── Fon rezervasyonu (Aşama 1) — SELECT FOR UPDATE burada devreye girer ─────
  //
  // Akış:
  //   BEGIN
  //   SELECT FOR UPDATE → diğer tüm rezervasyonları blokla (aynı userId)
  //   İdempotency kontrolü
  //   Bakiye yeterliliği kontrolü
  //   reserved += amount, INSERT transaction
  //   COMMIT

  async reserveFunds(
    userId:         UserId,
    amount:         number,
    idempotencyKey: string,
    txId:           TxId    = randomUUID(),
  ): Promise<Transaction> {
    return this.pool.withTransaction(async (client) => {
      // Satır kilitli SELECT: aynı kullanıcı için eşzamanlı işlemleri serialize eder
      const walletRow = await client.query(
        'SELECT balance, reserved, version FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      if (walletRow.rows.length === 0) throw new WalletNotFoundError(userId);

      // İdempotency kontrolü — kilit içinde yapılır (race condition önlemi)
      const existing = await client.query(
        'SELECT * FROM transactions WHERE idempotency_key = $1 LIMIT 1',
        [idempotencyKey],
      );
      if (existing.rows.length > 0) return this.rowToTx(existing.rows[0]);

      const balance   = parseInt(walletRow.rows[0].balance);
      const reserved  = parseInt(walletRow.rows[0].reserved);
      const available = balance - reserved;

      if (available < amount) throw new InsufficientFundsError(available, amount);

      await client.query(
        `UPDATE wallets
         SET reserved = reserved + $1, version = version + 1
         WHERE user_id = $2`,
        [amount, userId],
      );

      const txRow = await client.query(
        `INSERT INTO transactions
           (tx_id, user_id, type, amount, status, idempotency_key)
         VALUES ($1, $2, 'BUY_PLAYER', $3, 'PENDING', $4)
         RETURNING *`,
        [txId, userId, amount, idempotencyKey],
      );
      return this.rowToTx(txRow.rows[0]);
    });
  }

  // ── Rezervasyonu onayla (Aşama 2a) ──────────────────────────────────────────

  async commitReservation(txId: TxId): Promise<Transaction> {
    return this.pool.withTransaction(async (client) => {
      const txRow = await client.query(
        'SELECT * FROM transactions WHERE tx_id = $1 FOR UPDATE',
        [txId],
      );
      if (txRow.rows.length === 0) throw new TransactionNotFoundError(txId);
      const tx = txRow.rows[0];
      if (tx.status !== 'PENDING') {
        throw new InvalidTransactionStateError(txId, tx.status, 'PENDING');
      }

      const amount = parseInt(tx.amount);
      await client.query(
        `UPDATE wallets
         SET balance  = balance  - $1,
             reserved = reserved - $1,
             version  = version  + 1
         WHERE user_id = $2`,
        [amount, tx.user_id],
      );

      const updated = await client.query(
        `UPDATE transactions SET status = 'COMMITTED' WHERE tx_id = $1 RETURNING *`,
        [txId],
      );
      return this.rowToTx(updated.rows[0]);
    });
  }

  // ── Rezervasyonu geri al (Aşama 2b) ─────────────────────────────────────────
  //
  // idempotency_key NULL'a set edilir → aynı key ile yeniden denenebilir
  // (NULL değerler UNIQUE kısıtlamasında çakışmaz)

  async rollbackReservation(txId: TxId): Promise<Transaction> {
    return this.pool.withTransaction(async (client) => {
      const txRow = await client.query(
        'SELECT * FROM transactions WHERE tx_id = $1 FOR UPDATE',
        [txId],
      );
      if (txRow.rows.length === 0) throw new TransactionNotFoundError(txId);
      const tx = txRow.rows[0];
      if (tx.status !== 'PENDING') {
        throw new InvalidTransactionStateError(txId, tx.status, 'PENDING');
      }

      const amount = parseInt(tx.amount);
      await client.query(
        `UPDATE wallets
         SET reserved = reserved - $1, version = version + 1
         WHERE user_id = $2`,
        [amount, tx.user_id],
      );

      const updated = await client.query(
        `UPDATE transactions
         SET status = 'ROLLED_BACK', idempotency_key = NULL
         WHERE tx_id = $1
         RETURNING *`,
        [txId],
      );
      return this.rowToTx(updated.rows[0]);
    });
  }

  // ── Para yaz (satış kazancı, performans, yatırma) ────────────────────────────

  async credit(
    userId:         UserId,
    amount:         number,
    type:           TxType,
    idempotencyKey: string,
    txId:           TxId    = randomUUID(),
    playerId?:      string,
  ): Promise<Transaction> {
    return this.pool.withTransaction(async (client) => {
      // Kilit al — idempotency check ve balance update seri çalışsın
      await client.query(
        'SELECT version FROM wallets WHERE user_id = $1 FOR UPDATE',
        [userId],
      );

      const existing = await client.query(
        'SELECT * FROM transactions WHERE idempotency_key = $1 LIMIT 1',
        [idempotencyKey],
      );
      if (existing.rows.length > 0) return this.rowToTx(existing.rows[0]);

      await client.query(
        'UPDATE wallets SET balance = balance + $1, version = version + 1 WHERE user_id = $2',
        [amount, userId],
      );

      const txRow = await client.query(
        `INSERT INTO transactions
           (tx_id, user_id, type, amount, status, idempotency_key, player_id)
         VALUES ($1, $2, $3, $4, 'COMMITTED', $5, $6)
         RETURNING *`,
        [txId, userId, type, amount, idempotencyKey, playerId ?? null],
      );
      return this.rowToTx(txRow.rows[0]);
    });
  }

  // ── Liderlik tablosu ─────────────────────────────────────────────────────────

  async getLeaderboard(): Promise<Array<{ userId: string; balance: number; available: number }>> {
    const r = await this.pool.query(
      'SELECT user_id, balance, balance - reserved AS available FROM wallets ORDER BY available DESC',
    );
    return r.rows.map(row => ({
      userId:    row.user_id!,
      balance:   parseInt(row.balance ?? '0'),
      available: parseInt(row.available ?? '0'),
    }));
  }

  // ── Geçmiş / sorgular ────────────────────────────────────────────────────────

  async getHistory(userId: UserId): Promise<Transaction[]> {
    const r = await this.pool.query(
      'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return r.rows.map(row => this.rowToTx(row));
  }

  async getByIdempotencyKey(key: string): Promise<Transaction | undefined> {
    const r = await this.pool.query(
      'SELECT * FROM transactions WHERE idempotency_key = $1 LIMIT 1',
      [key],
    );
    return r.rows.length > 0 ? this.rowToTx(r.rows[0]) : undefined;
  }

  // ── Dönüştürücüler ───────────────────────────────────────────────────────────

  private rowToSnapshot(row: Record<string, string | null>): WalletSnapshot {
    return {
      userId:   row.user_id!,
      balance:  parseInt(row.balance ?? '0'),
      reserved: parseInt(row.reserved ?? '0'),
      version:  parseInt(row.version ?? '0'),
    };
  }

  private rowToTx(row: Record<string, string | null>): Transaction {
    return {
      txId:           row.tx_id!,
      userId:         row.user_id!,
      type:           row.type as TxType,
      amount:         parseInt(row.amount ?? '0'),
      status:         row.status as Transaction['status'],
      idempotencyKey: row.idempotency_key ?? '',
      playerId:       row.player_id ?? undefined,
      timestamp:      row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    };
  }
}
