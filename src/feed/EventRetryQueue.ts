import { EventEmitter } from 'events';
import { MatchEvent }   from '../events/types';
import { EventPipeline } from '../events/EventPipeline';

// ── EventRetryQueue — Başarısız event yeniden deneme kuyruğu ─────────────────
//
// WebhookReceiver veya LiveFeedClient'tan gelen eventler dispatch() sırasında
// hata alırsa bu kuyruğa eklenir.  Üstel geri çekilme ile yeniden denenir.
// maxAttempts aşılırsa Dead Letter Queue'ya (DLQ) taşınır — kaybolmaz.
//
// Olaylar:
//   'enqueued'    — { eventId, attempts:1 }
//   'retry'       — { eventId, attempts, nextDelayMs }
//   'success'     — { eventId, attempts }
//   'dead_letter' — { eventId, attempts, error }

export interface RetryQueueConfig {
  maxAttempts?:    number;   // DLQ'dan önce maks deneme sayısı  (default: 5)
  initialDelayMs?: number;   // ilk yeniden deneme gecikmesi      (default: 200)
  maxDelayMs?:     number;   // maks gecikme üst sınırı           (default: 60_000)
  flushIntervalMs?: number;  // kuyruk tarama sıklığı             (default: 500)
}

interface RetryItem {
  event:     MatchEvent;
  attempts:  number;
  nextRetry: number;
  lastError: string;
}

export class EventRetryQueue extends EventEmitter {
  private readonly cfg: Required<RetryQueueConfig>;
  private queue:   RetryItem[] = [];
  private dlq:     RetryItem[] = [];
  private timer:   NodeJS.Timeout | null = null;

  constructor(
    private readonly pipeline: EventPipeline,
    cfg: RetryQueueConfig = {},
  ) {
    super();
    this.cfg = {
      maxAttempts:    cfg.maxAttempts    ?? 5,
      initialDelayMs: cfg.initialDelayMs ?? 200,
      maxDelayMs:     cfg.maxDelayMs     ?? 60_000,
      flushIntervalMs: cfg.flushIntervalMs ?? 500,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.flush().catch(() => {}); }, this.cfg.flushIntervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  enqueue(event: MatchEvent, error: string): void {
    this.queue.push({
      event,
      attempts:  1,
      nextRetry: Date.now() + this.cfg.initialDelayMs,
      lastError: error,
    });
    this.emit('enqueued', { eventId: event.eventId, attempts: 1 });
  }

  getQueueDepth(): number { return this.queue.length; }
  getDlqDepth():   number { return this.dlq.length; }

  /** DLQ snapshot — readonly görünüm */
  getDlq(): ReadonlyArray<{ eventId: string; attempts: number; lastError: string }> {
    return this.dlq.map(i => ({
      eventId:   i.event.eventId,
      attempts:  i.attempts,
      lastError: i.lastError,
    }));
  }

  // ── Flush döngüsü ─────────────────────────────────────────────────────────

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    const now   = Date.now();
    const ready: RetryItem[] = [];
    const wait:  RetryItem[] = [];

    for (const item of this.queue) {
      (item.nextRetry <= now ? ready : wait).push(item);
    }
    this.queue = wait;

    for (const item of ready) {
      try {
        await this.pipeline.dispatch(item.event);
        this.emit('success', { eventId: item.event.eventId, attempts: item.attempts });
      } catch (err) {
        item.attempts++;
        item.lastError = (err as Error).message;

        if (item.attempts > this.cfg.maxAttempts) {
          this.dlq.push(item);
          this.emit('dead_letter', {
            eventId:   item.event.eventId,
            attempts:  item.attempts,
            error:     item.lastError,
          });
          console.error(
            `[RetryQueue] DLQ: ${item.event.eventId} — ${item.attempts} deneme, son hata: ${item.lastError}`,
          );
        } else {
          // Üstel geri çekilme: 200ms → 400 → 800 → 1600 → 3200 → cap
          const delay = Math.min(
            this.cfg.initialDelayMs * Math.pow(2, item.attempts - 1),
            this.cfg.maxDelayMs,
          );
          item.nextRetry = now + delay;
          this.queue.push(item);
          this.emit('retry', {
            eventId:     item.event.eventId,
            attempts:    item.attempts,
            nextDelayMs: delay,
          });
        }
      }
    }
  }
}
