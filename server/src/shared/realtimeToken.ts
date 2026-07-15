import { createHmac, timingSafeEqual } from "crypto";

// Short-lived token so a browser WebSocket (which can't send auth headers or
// share the session cookie cross-origin) can prove who it is to the worker.
// Format: `userId.exp.sig`, sig = base64url(HMAC-SHA256(secret, `userId.exp`)).

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signRealtimeToken(userId: string, secret: string, ttlSec = 120): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyRealtimeToken(token: string, secret: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sig] = parts;
  if (!userId || !/^\d+$/.test(expStr)) return null;
  if (Number(expStr) * 1000 < Date.now()) return null;

  const expected = sign(`${userId}.${expStr}`, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return userId;
}
