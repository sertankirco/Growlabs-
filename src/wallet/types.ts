export type UserId   = string;
export type PlayerId = string;
export type TxId     = string;

export type Position = 'GK' | 'DEF' | 'MID' | 'FWD';
export type SlotType = 'starting' | 'bench';

export interface Player {
  id:               PlayerId;
  name:             string;
  position:         Position;
  marketPrice:      number;
  performanceScore: number;
}

// ── Wallet ──────────────────────────────────────────────────────────────────

export interface WalletSnapshot {
  userId:    UserId;
  balance:   number;  // onaylanmış bakiye
  reserved:  number;  // bekleyen işlemler için kilitli miktar
  version:   number;  // optimistik kilit sayacı
}

// ── Squad ───────────────────────────────────────────────────────────────────

export interface SquadEntry {
  player:  Player;
  slot:    SlotType;
  addedAt: number;
}

export interface SquadSnapshot {
  userId:  UserId;
  entries: SquadEntry[];
  version: number;
}

// ── Transactions ─────────────────────────────────────────────────────────────

export type TxType =
  | 'DEPOSIT'
  | 'BUY_PLAYER'
  | 'SELL_PLAYER'
  | 'PERFORMANCE_EARNINGS'
  | 'WITHDRAWAL';

export type TxStatus = 'PENDING' | 'COMMITTED' | 'ROLLED_BACK';

export interface Transaction {
  txId:            TxId;
  userId:          UserId;
  type:            TxType;
  amount:          number;
  status:          TxStatus;
  playerId?:       PlayerId;
  timestamp:       number;
  idempotencyKey:  string;
}
