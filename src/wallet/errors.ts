export class InsufficientFundsError extends Error {
  readonly available: number;
  readonly required:  number;

  constructor(available: number, required: number) {
    super(`Yetersiz bakiye: mevcut=${available}, gereken=${required}`);
    this.name      = 'InsufficientFundsError';
    this.available = available;
    this.required  = required;
  }
}

export class DuplicateTransactionError extends Error {
  constructor(idempotencyKey: string) {
    super(`Tekrar eden işlem anahtarı: ${idempotencyKey}`);
    this.name = 'DuplicateTransactionError';
  }
}

export class TransactionNotFoundError extends Error {
  constructor(txId: string) {
    super(`İşlem bulunamadı: ${txId}`);
    this.name = 'TransactionNotFoundError';
  }
}

export class InvalidTransactionStateError extends Error {
  constructor(txId: string, current: string, expected: string) {
    super(`İşlem durumu geçersiz [${txId}]: mevcut=${current}, beklenen=${expected}`);
    this.name = 'InvalidTransactionStateError';
  }
}

export class WalletNotFoundError extends Error {
  constructor(userId: string) {
    super(`Cüzdan bulunamadı: ${userId}`);
    this.name = 'WalletNotFoundError';
  }
}

export class SquadNotFoundError extends Error {
  constructor(userId: string) {
    super(`Kadro bulunamadı: ${userId}`);
    this.name = 'SquadNotFoundError';
  }
}

export class SquadCapacityError extends Error {
  constructor(slot: string, max: number) {
    super(`Kadro kapasitesi dolu: ${slot} (max ${max})`);
    this.name = 'SquadCapacityError';
  }
}

export class PlayerAlreadyInSquadError extends Error {
  constructor(playerId: string) {
    super(`Oyuncu zaten kadroda: ${playerId}`);
    this.name = 'PlayerAlreadyInSquadError';
  }
}

export class PlayerNotInSquadError extends Error {
  constructor(playerId: string) {
    super(`Oyuncu kadroda değil: ${playerId}`);
    this.name = 'PlayerNotInSquadError';
  }
}

export class PlayerNotInMarketError extends Error {
  constructor(playerId: string) {
    super(`Oyuncu piyasada bulunamadı: ${playerId}`);
    this.name = 'PlayerNotInMarketError';
  }
}
