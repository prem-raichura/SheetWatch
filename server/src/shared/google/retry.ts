// Retry transient Google API failures (rate limits, server errors, network
// blips) with exponential backoff. Other errors (401/403/404, parse errors)
// rethrow immediately so callers can handle them per-status.
const NETWORK_CODES = new Set(["ENOTFOUND", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ECONNREFUSED"]);

export function isTransient(err: any): boolean {
  const status = err?.code ?? err?.status ?? err?.response?.status;
  if (status === 429 || (typeof status === "number" && status >= 500 && status < 600)) return true;
  const code = err?.code ?? err?.cause?.code ?? err?.errno;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  // Some fetch wrappers surface only a numeric errno; fall back to the message.
  const msg = String(err?.message ?? "");
  return /ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|socket hang up|network/i.test(msg);
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || i === attempts - 1) throw err;
      const delay = 1000 * 2 ** i + Math.random() * 250;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
