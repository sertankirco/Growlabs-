import { request as httpRequest } from 'http';

// ── LoadTester — Sunucu içi yük testi ────────────────────────────────────────
//
// Dış araç gerektirmez; her sanal kullanıcı farklı bir X-Forwarded-For başlığı
// kullanarak rate limiter'ı bypass eder (gerçek dağıtık yük simülasyonu).
// GET /market ağırlıklı test → okuma yoğun iş yükü (oyunun gerçek profili).

export interface LoadTestConfig {
  users:      number;   // eşzamanlı sanal kullanıcı
  durationMs: number;   // test süresi (ms)
  host:       string;
  port:       number;
}

export interface LoadTestResult {
  users:          number;
  totalRequests:  number;
  successCount:   number;
  errorCount:     number;
  rateLimited:    number;
  latencyP50Ms:   number;
  latencyP95Ms:   number;
  latencyP99Ms:   number;
  reqPerSec:      number;
  durationMs:     number;
}

function makeGet(host: string, port: number, path: string, fakeIp: string): Promise<{ status: number; ms: number }> {
  return new Promise((resolve, reject) => {
    const t0  = Date.now();
    const req = httpRequest(
      { host, port, path, method: 'GET', headers: { 'X-Forwarded-For': fakeIp } },
      (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode ?? 0, ms: Date.now() - t0 })); },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function runLoadTest(cfg: LoadTestConfig): Promise<LoadTestResult> {
  const latencies: number[] = [];
  let errors  = 0;
  let limited = 0;
  const deadline = Date.now() + cfg.durationMs;

  const worker = async (idx: number) => {
    // Her sanal kullanıcı farklı IP — 10.x.y.z bloğu
    const fakeIp = `10.${Math.floor(idx / 254)}.${idx % 254}.1`;
    const path   = '/market';

    while (Date.now() < deadline) {
      try {
        const r = await makeGet(cfg.host, cfg.port, path, fakeIp);
        if (r.status === 429)       { limited++; await sleep(200); }
        else if (r.status >= 500)   { errors++;  latencies.push(r.ms); }
        else                        { latencies.push(r.ms); }
      } catch { errors++; }
      // ~20 req/sn/kullanıcı
      await sleep(50);
    }
  };

  await Promise.allSettled(Array.from({ length: cfg.users }, (_, i) => worker(i)));

  latencies.sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.floor(latencies.length * p)] ?? 0;

  return {
    users:         cfg.users,
    totalRequests: latencies.length + errors + limited,
    successCount:  latencies.length,
    errorCount:    errors,
    rateLimited:   limited,
    latencyP50Ms:  pct(0.50),
    latencyP95Ms:  pct(0.95),
    latencyP99Ms:  pct(0.99),
    reqPerSec:     latencies.length > 0 ? Math.round(latencies.length / (cfg.durationMs / 1000)) : 0,
    durationMs:    cfg.durationMs,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
