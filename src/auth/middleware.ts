import { RouteContext, RouteHandler, json } from '../api/HttpRouter';
import { verifyToken } from './jwt';

const JWT_SECRET = process.env.JWT_SECRET ?? 'wc2026-dev-secret-change-in-prod';

// ── requireAuth ───────────────────────────────────────────────────────────────
//
// Handler sarmalayıcı: Authorization: Bearer <token> başlığını doğrular.
// Token geçersizse 401 döner, geçerliyse ctx.authUserId'yi doldurur.
//
// Kullanım:
//   router.post('/transfer/buy', requireAuth(h.buyPlayer));

export function requireAuth(handler: RouteHandler): RouteHandler {
  return async (ctx: RouteContext) => {
    const rawAuth = ctx.req.headers['authorization'] ?? '';
    const auth    = Array.isArray(rawAuth) ? (rawAuth[0] ?? '') : rawAuth;
    const token   = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const payload = token ? verifyToken(token, JWT_SECRET) : null;

    if (!payload) {
      json(ctx.res, 401, { error: 'Yetkisiz: geçerli Bearer token gerekli' });
      return;
    }

    ctx.authUserId = payload.userId;
    return handler(ctx);
  };
}

// ── assertSelf ────────────────────────────────────────────────────────────────
//
// Token'daki userId ile istekteki userId'nin eşleştiğini doğrular.
// Farklıysa 403 döner.
//
// Kullanım:
//   const uid = assertSelf(ctx, params.userId);
//   if (!uid) return;

export function assertSelf(ctx: RouteContext, requestedUserId: string): string | null {
  if (ctx.authUserId !== requestedUserId) {
    json(ctx.res, 403, { error: 'Yasak: yalnızca kendi hesabınıza erişebilirsiniz' });
    return null;
  }
  return ctx.authUserId;
}

export { JWT_SECRET };
