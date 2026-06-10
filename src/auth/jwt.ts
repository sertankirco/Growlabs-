import { createHmac, timingSafeEqual } from 'crypto';

// ── JWT HS256 — sıfır bağımlılık ─────────────────────────────────────────────
//
// RFC 7519 uyumlu minimal JWT:
//   header.payload.signature  (tüm parçalar base64url)
//
// Güvenlik notları:
//   - timingSafeEqual: timing attack'a karşı sabit süreli karşılaştırma
//   - exp kontrolü: süresi dolmuş token reddedilir
//   - HS256: HMAC-SHA256

const ALGORITHM = 'sha256';
const HEADER    = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

export interface JwtPayload {
  userId:  string;
  iat:     number;   // issued at (saniye)
  exp:     number;   // expiry   (saniye)
}

export function signToken(userId: string, secret: string, ttlDays = 1): string {
  const now     = Math.floor(Date.now() / 1000);
  const payload = base64url(JSON.stringify({
    userId,
    iat: now,
    exp: now + ttlDays * 86400,
  } satisfies JwtPayload));

  const sig = sign(`${HEADER}.${payload}`, secret);
  return `${HEADER}.${payload}.${sig}`;
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  // İmza doğrula (timing-safe)
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const actual   = Buffer.from(signature);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  // Payload parse
  let data: JwtPayload;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  } catch {
    return null;
  }

  // Expiry kontrol
  if (Math.floor(Date.now() / 1000) > data.exp) return null;

  return data;
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function sign(input: string, secret: string): string {
  return createHmac(ALGORITHM, secret).update(input).digest('base64url');
}

function base64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}
