import { IncomingMessage, ServerResponse } from 'http';

// ── Hafif HTTP Router (sıfır bağımlılık) ─────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RouteContext {
  req:    IncomingMessage;
  res:    ServerResponse;
  params: Record<string, string>;  // URL parametreleri  :id, :userId vb.
  body:   unknown;                  // parsed JSON body
  query:  Record<string, string>;  // ?key=val
}

export type RouteHandler = (ctx: RouteContext) => Promise<void> | void;

interface Route {
  method:  HttpMethod;
  pattern: RegExp;
  keys:    string[];
  handler: RouteHandler;
}

export class HttpRouter {
  private readonly routes: Route[] = [];

  // ── Route kaydı ──────────────────────────────────────────────────────────────

  get   (path: string, handler: RouteHandler): void { this.add('GET',    path, handler); }
  post  (path: string, handler: RouteHandler): void { this.add('POST',   path, handler); }
  put   (path: string, handler: RouteHandler): void { this.add('PUT',    path, handler); }
  delete(path: string, handler: RouteHandler): void { this.add('DELETE', path, handler); }

  // ── İstek işleme ─────────────────────────────────────────────────────────────

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url    = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = (req.method ?? 'GET').toUpperCase() as HttpMethod;
    const path   = url.pathname;
    const query  = Object.fromEntries(url.searchParams.entries());

    for (const route of this.routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;

      const params = Object.fromEntries(
        route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1] ?? '')]),
      );

      let body: unknown = null;
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        body = await readBody(req);
      }

      try {
        await route.handler({ req, res, params, body, query });
      } catch (err: unknown) {
        if (!res.headersSent) {
          const msg = err instanceof Error ? err.message : String(err);
          json(res, 500, { error: msg });
        }
      }
      return;
    }

    json(res, 404, { error: `${method} ${path} bulunamadı` });
  }

  private add(method: HttpMethod, path: string, handler: RouteHandler): void {
    const keys:    string[] = [];
    const pattern = new RegExp(
      '^' +
      path
        .replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; })
        .replace(/\//g, '\\/') +
      '(?:\\/)?$',
    );
    this.routes.push({ method, pattern, keys, handler });
  }
}

// ── Yardımcı yanıt fonksiyonları ─────────────────────────────────────────────

export function json(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c));
    req.on('end',  () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) { resolve(null); return; }
      try { resolve(JSON.parse(raw)); }
      catch { resolve(raw); }
    });
    req.on('error', reject);
  });
}
