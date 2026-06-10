// ── Metrics — Basit sayaçlar, Prometheus text formatı ────────────────────────
//
// Dış bağımlılık yok. /metrics endpoint'i bu sınıfı kullanır.
// Prometheus + Grafana ile doğrudan entegre çalışır.

export class Metrics {
  private readonly counts    = new Map<string, number>();
  private readonly startTime = Date.now();

  inc(name: string, by = 1): void {
    this.counts.set(name, (this.counts.get(name) ?? 0) + by);
  }

  get(name: string): number {
    return this.counts.get(name) ?? 0;
  }

  // Prometheus text exposition format (OpenMetrics uyumlu)
  toPrometheus(gauges: Record<string, number> = {}): string {
    const lines: string[] = [];
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    for (const [k, v] of this.counts) {
      lines.push(`# TYPE ${k} counter`);
      lines.push(`${k} ${v}`);
    }

    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${uptime}`);

    for (const [k, v] of Object.entries(gauges)) {
      lines.push(`# TYPE ${k} gauge`);
      lines.push(`${k} ${v}`);
    }

    return lines.join('\n') + '\n';
  }
}
