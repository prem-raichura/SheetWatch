import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

// vi.mock is hoisted above the file's consts, so the spy has to be too.
const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("../../shared/prisma", () => ({
  default: { user: { findUnique } },
}));

import { requireAdmin, parseAdminEmails, resetAdminEmails } from "../middleware/requireAdmin";

// Hand-rolled fakes rather than supertest — the repo's tests carry no HTTP
// dependency and this middleware needs no server to exercise.
function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    locals: {} as Record<string, unknown>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = (userId?: string) => ({ session: userId ? { userId } : undefined }) as unknown as Request;

describe("parseAdminEmails", () => {
  it("normalizes case, whitespace and blanks", () => {
    expect(parseAdminEmails(" A@B.com ,,c@d.com ")).toEqual(["a@b.com", "c@d.com"]);
    expect(parseAdminEmails(undefined)).toEqual([]);
  });

  it("refuses a wildcard outright", () => {
    // A '*' becomes a total auth bypass the moment anyone teaches the matcher
    // to glob — fail loudly rather than treat it as a literal address.
    expect(() => parseAdminEmails("*@example.com")).toThrow(/wildcard/i);
    expect(() => parseAdminEmails("not-an-email")).toThrow(/invalid address/i);
  });
});

describe("requireAdmin", () => {
  beforeEach(() => {
    findUnique.mockReset();
    resetAdminEmails();
    process.env.ADMIN_EMAILS = "ops@example.com";
  });

  it("passes a listed email through, case-insensitively", async () => {
    findUnique.mockResolvedValue({ email: "OPS@Example.com" });
    const res = fakeRes();
    const next = vi.fn();
    await requireAdmin(req("u1"), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.locals.adminEmail).toBe("OPS@Example.com");
  });

  it("404s an unlisted email, identically to an unknown path", async () => {
    findUnique.mockResolvedValue({ email: "someone@else.com" });
    const res = fakeRes();
    const next = vi.fn();
    await requireAdmin(req("u1"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    // Byte-identical to app.ts's unmatched-/api handler, so a prober cannot
    // tell "not on the allowlist" from "no such route".
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("404s everyone when ADMIN_EMAILS is unset", async () => {
    delete process.env.ADMIN_EMAILS;
    resetAdminEmails();
    findUnique.mockResolvedValue({ email: "ops@example.com" });
    const res = fakeRes();
    const next = vi.fn();
    await requireAdmin(req("u1"), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("404s a missing user and a DB failure without throwing", async () => {
    findUnique.mockResolvedValue(null);
    const res1 = fakeRes();
    await requireAdmin(req("ghost"), res1, vi.fn());
    expect(res1.statusCode).toBe(404);

    findUnique.mockRejectedValue(new Error("db down"));
    const res2 = fakeRes();
    const next = vi.fn();
    await expect(requireAdmin(req("u1"), res2, next)).resolves.toBeUndefined();
    expect(res2.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });
});
