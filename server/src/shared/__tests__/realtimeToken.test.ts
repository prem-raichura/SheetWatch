import { describe, expect, it } from "vitest";
import { signRealtimeToken, verifyRealtimeToken } from "../realtimeToken";

const SECRET = "test-secret";

describe("realtime token", () => {
  it("signs and verifies a roundtrip", () => {
    const token = signRealtimeToken("user_123", SECRET);
    expect(verifyRealtimeToken(token, SECRET)).toBe("user_123");
  });

  it("rejects a wrong secret", () => {
    const token = signRealtimeToken("user_123", SECRET);
    expect(verifyRealtimeToken(token, "other-secret")).toBeNull();
  });

  it("rejects a tampered userId", () => {
    const token = signRealtimeToken("user_123", SECRET);
    const [, exp, sig] = token.split(".");
    expect(verifyRealtimeToken(`user_evil.${exp}.${sig}`, SECRET)).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = signRealtimeToken("user_123", SECRET, -1);
    expect(verifyRealtimeToken(token, SECRET)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(verifyRealtimeToken("", SECRET)).toBeNull();
    expect(verifyRealtimeToken("a.b", SECRET)).toBeNull();
    expect(verifyRealtimeToken("a.notanumber.c", SECRET)).toBeNull();
  });
});
