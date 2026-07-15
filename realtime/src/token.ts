// Verifies the short-lived HMAC token minted by the SheetWatch server:
// format `userId.exp.sig` where sig = HMAC-SHA256(secret, `userId.exp`)
// base64url-encoded. Returns the userId or null.

function base64urlToBytes(s: string): Uint8Array | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export async function verifyToken(token: string, secret: string): Promise<string | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expStr, sigB64] = parts;
  if (!userId || !/^\d+$/.test(expStr)) return null;

  const exp = Number(expStr);
  if (exp * 1000 < Date.now()) return null;

  const sig = base64urlToBytes(sigB64);
  if (!sig) return null;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    sig as unknown as ArrayBuffer,
    enc.encode(`${userId}.${expStr}`)
  );
  return ok ? userId : null;
}
