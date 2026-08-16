import { Request, Response, NextFunction } from "express";
import prisma from "../../shared/prisma";

// Ops access is an env allowlist, not a database role: the set of people who
// may read the whole system's health changes about once a year, and keeping it
// out of the DB means a compromised session can never grant it.
//
// Parsed on first use rather than at module load so the value is read after
// dotenv has run, whatever the import order.
let cached: Set<string> | null = null;

export function parseAdminEmails(raw: string | undefined): string[] {
  const entries = (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const entry of entries) {
    // A wildcard here would be a total auth bypass the moment anyone teaches
    // the matcher to glob. Refuse it outright rather than silently treating it
    // as a literal address.
    if (entry.includes("*")) {
      throw new Error("ADMIN_EMAILS must be concrete addresses — no wildcards");
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(entry)) {
      throw new Error(`ADMIN_EMAILS contains an invalid address: ${entry}`);
    }
  }
  return entries;
}

export function adminEmails(): Set<string> {
  if (!cached) cached = new Set(parseAdminEmails(process.env.ADMIN_EMAILS));
  return cached;
}

// Test seam — env changes mid-process otherwise sit behind the memo.
export function resetAdminEmails(): void {
  cached = null;
}

export function isAdminEmail(email: string | null | undefined): boolean {
  const allow = adminEmails();
  if (allow.size === 0 || !email) return false;
  return allow.has(email.trim().toLowerCase());
}

// Mounted after requireAuth, so a signed-out caller has already had a clean 401.
//
// Denies with 404, byte-identical to the app's unmatched-/api handler: a 403
// would confirm both that /api/admin exists and that an allowlist guards it,
// which is a map for anyone probing. The cost is self-debuggability, so the
// reason goes to the server log where only we can read it.
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const notFound = () => res.status(404).json({ error: "Not found" });

  if (adminEmails().size === 0) {
    console.warn("Admin denied: ADMIN_EMAILS is not set");
    notFound();
    return;
  }

  const userId = (res.locals.userId ?? req.session?.userId) as string | undefined;
  if (!userId) {
    notFound();
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    if (!user || !isAdminEmail(user.email)) {
      console.warn(`Admin denied for ${user?.email ?? userId}`);
      notFound();
      return;
    }
    res.locals.adminEmail = user.email;
    next();
  } catch (err) {
    console.error("Admin check failed:", err);
    notFound();
  }
}
