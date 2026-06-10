import { EventEmitter } from 'events';

export interface TransferWindowSnapshot {
  status:       'OPEN' | 'CLOSED';
  closedReason: string | null;
  closedAt:     number | null;
  activeMatches: number;
}

// ── TransferWindow ────────────────────────────────────────────────────────────
//
// Al/sat işlemleri yalnızca maç aralarında (pencere AÇIK) yapılabilir.
// Birden fazla eşzamanlı maç desteği: son maç bitince pencere açılır.
//
// Olaylar:
//   'closed' — { reason, matchId }
//   'opened' — {}

export class TransferWindow extends EventEmitter {
  private status:        'OPEN' | 'CLOSED' = 'OPEN';
  private closedReason:  string | null      = null;
  private closedAt:      number | null      = null;
  private activeMatchIds = new Set<string>();

  close(matchId: string, reason = 'Maç devam ediyor'): void {
    this.activeMatchIds.add(matchId);
    if (this.status === 'OPEN') {
      this.status       = 'CLOSED';
      this.closedReason = reason;
      this.closedAt     = Date.now();
      this.emit('closed', { reason, matchId });
    }
  }

  open(matchId: string): void {
    this.activeMatchIds.delete(matchId);
    if (this.activeMatchIds.size === 0 && this.status === 'CLOSED') {
      this.status       = 'OPEN';
      this.closedReason = null;
      this.closedAt     = null;
      this.emit('opened', {});
    }
  }

  // Maç iptal edildi — zorla serbest bırak (hem activeMatchIds temizle hem de pencereyi aç)
  forceOpen(matchId: string): void {
    this.activeMatchIds.delete(matchId);
    if (this.activeMatchIds.size === 0 && this.status === 'CLOSED') {
      this.status       = 'OPEN';
      this.closedReason = null;
      this.closedAt     = null;
      this.emit('opened', {});
    }
  }

  check(): { allowed: boolean; reason?: string } {
    if (this.status === 'OPEN') return { allowed: true };
    return { allowed: false, reason: this.closedReason ?? 'Maç devam ediyor' };
  }

  getStatus(): 'OPEN' | 'CLOSED' { return this.status; }

  getSnapshot(): TransferWindowSnapshot {
    return {
      status:        this.status,
      closedReason:  this.closedReason,
      closedAt:      this.closedAt,
      activeMatches: this.activeMatchIds.size,
    };
  }
}
