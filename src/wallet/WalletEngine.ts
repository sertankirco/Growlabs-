import { randomUUID } from 'crypto';
import {
  UserId, TxId, TxType, Transaction, WalletSnapshot,
} from './types';
import {
  InsufficientFundsError,
  DuplicateTransactionError,
  TransactionNotFoundError,
  InvalidTransactionStateError,
  WalletNotFoundError,
} from './errors';

// ── Per-user async mutex (Promise-chain queue) ───────────────────────────────
//
// Node.js tek thread'lidir; ancak await sırasında context switch gerçekleşir.
// Her kullanıcı için sıralı bir Promise zinciri tutarak aynı cüzdan üzerinde
// eşzamanlı read-modify-write döngülerini tamamen engelliyoruz.
//
// Örnek senaryo:
//   coroutine A → reserveFunds(600)  ─┐  her ikisi aynı anda çağrılır
//   coroutine B → reserveFunds(600)  ─┘  bakiye = 1000
//
//   Mutex olmadan: A okur 1000, B okur 1000, ikisi de rezerve eder → double-spend
//   Mutex ile:     A çalışır → reserved=600; B çalışır → available=400 < 600 → HATA

type MutexRelease = () => void;

class UserMutex {
  private tail: Promise<void> = Promise.resolve();

  async acquire(): Promise<MutexRelease> {
    let release!: MutexRelease;
    const prev = this.tail;
    this.tail = prev.then(() => new Promise<void>(resolve => { release = resolve; }));
    await prev;
    return release;
  }
}

// ── In-memory store (production'da DB transaction'a dönüşür) ─────────────────

interface WalletRecord {
  userId:   UserId;
  balance:  number;
  reserved: number;
  version:  number;
}

export class WalletEngine {
  private readonly wallets      = new Map<UserId, WalletRecord>();
  private readonly transactions = new Map<TxId,   Transaction>();
  private readonly idempotency  = new Map<string, TxId>();   // key → txId
  private readonly mutexes      = new Map<UserId, UserMutex>();

  // ── Mutex yardımcısı ────────────────────────────────────────────────────────

  private mutex(userId: UserId): UserMutex {
    if (!this.mutexes.has(userId)) this.mutexes.set(userId, new UserMutex());
    return this.mutexes.get(userId)!;
  }

  // ── Cüzdan yönetimi ─────────────────────────────────────────────────────────

  createWallet(userId: UserId, initialBalance = 0): WalletSnapshot {
    if (this.wallets.has(userId)) throw new Error(`Cüzdan zaten var: ${userId}`);
    const record: WalletRecord = { userId, balance: initialBalance, reserved: 0, version: 0 };
    this.wallets.set(userId, record);
    return this.snapshot(record);
  }

  getWallet(userId: UserId): WalletSnapshot {
    return this.snapshot(this.requireWallet(userId));
  }

  getAvailable(userId: UserId): number {
    const w = this.requireWallet(userId);
    return w.balance - w.reserved;
  }

  // ── Fon rezervasyonu (Aşama 1 — çift harcamayı burada engelliyoruz) ─────────
  //
  // Akış:
  //   1. Kullanıcı mutex'ini al (sıralı işlem garantisi)
  //   2. İdempotency kontrolü — aynı key daha önce işlendiyse mevcut tx'i dön
  //   3. available < amount ise InsufficientFundsError fırlat
  //   4. reserved += amount  (balance henüz değişmez)
  //   5. PENDING transaction kaydı oluştur
  //
  // Bu nokta geçilmeden bakiye asla düşmez; bu sayede paralel çağrılar birbirini
  // iptal edemez.

  async reserveFunds(
    userId:         UserId,
    amount:         number,
    idempotencyKey: string,
    txId:           TxId   = randomUUID(),
  ): Promise<Transaction> {
    const release = await this.mutex(userId).acquire();
    try {
      // İdempotency: aynı key daha önce rezerve edilmişse tekrar rezerve etme
      const existingTxId = this.idempotency.get(idempotencyKey);
      if (existingTxId !== undefined) {
        return { ...this.transactions.get(existingTxId)! };
      }

      const wallet    = this.requireWallet(userId);
      const available = wallet.balance - wallet.reserved;

      if (available < amount) {
        throw new InsufficientFundsError(available, amount);
      }

      wallet.reserved += amount;
      wallet.version  += 1;

      const tx: Transaction = {
        txId,
        userId,
        type:           'BUY_PLAYER',
        amount,
        status:         'PENDING',
        timestamp:      Date.now(),
        idempotencyKey,
      };

      this.transactions.set(txId, tx);
      this.idempotency.set(idempotencyKey, txId);
      return { ...tx };
    } finally {
      release();
    }
  }

  // ── Rezervasyonu onayla (Aşama 2a — başarılı satın alma) ───────────────────

  async commitReservation(txId: TxId): Promise<Transaction> {
    const tx = this.requireTx(txId);
    this.assertStatus(tx, 'PENDING');

    const release = await this.mutex(tx.userId).acquire();
    try {
      const wallet     = this.requireWallet(tx.userId);
      wallet.balance  -= tx.amount;
      wallet.reserved -= tx.amount;
      wallet.version  += 1;

      tx.status = 'COMMITTED';
      return { ...tx };
    } finally {
      release();
    }
  }

  // ── Rezervasyonu geri al (Aşama 2b — başarısız satın alma) ─────────────────
  //
  // Kilit açılır; idempotency kaydı da temizlenir ki aynı key ile yeniden
  // denenebilsin (örn. ağ hatası sonrası retry).

  async rollbackReservation(txId: TxId): Promise<Transaction> {
    const tx = this.requireTx(txId);
    this.assertStatus(tx, 'PENDING');

    const release = await this.mutex(tx.userId).acquire();
    try {
      const wallet     = this.requireWallet(tx.userId);
      wallet.reserved -= tx.amount;
      wallet.version  += 1;

      tx.status = 'ROLLED_BACK';
      this.idempotency.delete(tx.idempotencyKey);
      return { ...tx };
    } finally {
      release();
    }
  }

  // ── Bakiyeye para yaz (satış, performans kazancı, para yatırma) ─────────────

  async credit(
    userId:         UserId,
    amount:         number,
    type:           TxType,
    idempotencyKey: string,
    txId:           TxId     = randomUUID(),
    playerId?:      string,
  ): Promise<Transaction> {
    const release = await this.mutex(userId).acquire();
    try {
      const existingTxId = this.idempotency.get(idempotencyKey);
      if (existingTxId !== undefined) {
        return { ...this.transactions.get(existingTxId)! };
      }

      const wallet    = this.requireWallet(userId);
      wallet.balance += amount;
      wallet.version += 1;

      const tx: Transaction = {
        txId,
        userId,
        type,
        amount,
        status:         'COMMITTED',
        playerId,
        timestamp:      Date.now(),
        idempotencyKey,
      };

      this.transactions.set(txId, tx);
      this.idempotency.set(idempotencyKey, txId);
      return { ...tx };
    } finally {
      release();
    }
  }

  // ── İşlem geçmişi ────────────────────────────────────────────────────────────

  getHistory(userId: UserId): Transaction[] {
    return [...this.transactions.values()]
      .filter(t => t.userId === userId)
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  // Liderlik tablosu — tüm cüzdanlar azalan available bakiyeyle
  getLeaderboard(): Array<{ userId: string; balance: number; available: number }> {
    return [...this.wallets.values()]
      .map(r => ({ userId: r.userId, balance: r.balance, available: r.balance - r.reserved }))
      .sort((a, b) => b.available - a.available);
  }

  // İdempotency key ile işlem arama (ExchangeEngine için)
  getByIdempotencyKey(key: string): Transaction | undefined {
    const txId = this.idempotency.get(key);
    if (!txId) return undefined;
    const tx = this.transactions.get(txId);
    return tx ? { ...tx } : undefined;
  }

  // ── Yardımcılar ──────────────────────────────────────────────────────────────

  private requireWallet(userId: UserId): WalletRecord {
    const w = this.wallets.get(userId);
    if (!w) throw new WalletNotFoundError(userId);
    return w;
  }

  private requireTx(txId: TxId): Transaction {
    const tx = this.transactions.get(txId);
    if (!tx) throw new TransactionNotFoundError(txId);
    return tx;
  }

  private assertStatus(tx: Transaction, expected: Transaction['status']): void {
    if (tx.status !== expected) {
      throw new InvalidTransactionStateError(tx.txId, tx.status, expected);
    }
  }

  private snapshot(r: WalletRecord): WalletSnapshot {
    return { userId: r.userId, balance: r.balance, reserved: r.reserved, version: r.version };
  }
}
