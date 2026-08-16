import crypto from "crypto";
import { Router } from "express";
import { google } from "googleapis";
import prisma from "../../shared/prisma";
import { encrypt, decrypt } from "../../shared/crypto";
import { requireAuth } from "../middleware/requireAuth";
import { isAdminEmail } from "../middleware/requireAdmin";
import { rateLimit } from "../middleware/rateLimit";

const router = Router();

// Throttle the OAuth round-trip per IP (abuse / code-exchange hammering).
const authLimiter = rateLimit({ windowMs: 60_000, max: 20 });

// Read-write Sheets scope: reading covers watching/diffing; writing is needed
// to apply accepted cross-sheet suggestions back into target sheets.
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

const SCOPES = [
  SHEETS_SCOPE,
  // Full Drive scope: read-only covers listing/watching, but moving a
  // spreadsheet to trash from the Sheets page needs write access.
  "https://www.googleapis.com/auth/drive",
  "email",
  "profile",
];

// True when the granted scopes include full (read-write) Sheets access.
// tokens.scope is a space-delimited string; the read-only scope is a different
// URL, so an exact-token check avoids treating readonly as write.
function grantedSheetsWrite(scope: string | null | undefined): boolean {
  return (scope ?? "").split(" ").includes(SHEETS_SCOPE);
}

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

router.get("/google", authLimiter, (req, res) => {
  // CSRF protection: bind the OAuth round-trip to this browser session.
  const state = crypto.randomBytes(16).toString("hex");
  req.session!.oauthState = state;
  const client = makeOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  res.redirect(url);
});

router.get("/google/callback", authLimiter, async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
    return;
  }

  const expectedState = req.session?.oauthState as string | undefined;
  // One-time use: clear the state on both success and failure.
  if (req.session) delete req.session.oauthState;
  if (!expectedState || req.query.state !== expectedState) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=state_mismatch`);
    return;
  }

  try {
    const client = makeOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.id || !profile.email) throw new Error("Missing profile data");
    if (!tokens.access_token) throw new Error("No access token returned");

    const sheetsWrite = grantedSheetsWrite(tokens.scope);

    const user = await prisma.user.upsert({
      where: { googleId: profile.id },
      create: {
        googleId: profile.id,
        email: profile.email,
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token ?? ""),
        tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        sheetsWrite,
      },
      update: {
        email: profile.email,
        accessToken: encrypt(tokens.access_token),
        ...(tokens.refresh_token && { refreshToken: encrypt(tokens.refresh_token) }),
        tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
        sheetsWrite,
      },
    });

    req.session!.userId = user.id;
    res.redirect(`${process.env.FRONTEND_URL}/overview`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, googleId: true, createdAt: true, digest: true, digestHour: true, sheetsWrite: true },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  // Lets the app show a link to the ops dashboard to the people who can open
  // it. Not a permission in itself — /api/admin re-checks the allowlist on
  // every request, so a forged flag buys nothing.
  res.json({ ...user, isAdmin: isAdminEmail(user.email) });
});

router.patch("/me", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { digest, digestHour } = req.body as { digest?: string; digestHour?: number };

  if (digest !== undefined && !["off", "daily", "weekly"].includes(digest)) {
    res.status(400).json({ error: "digest must be off, daily or weekly" });
    return;
  }
  if (
    digestHour !== undefined &&
    (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23)
  ) {
    res.status(400).json({ error: "digestHour must be 0–23" });
    return;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(digest !== undefined && { digest }),
      ...(digestHour !== undefined && { digestHour }),
    },
    select: { id: true, email: true, googleId: true, createdAt: true, digest: true, digestHour: true, sheetsWrite: true },
  });
  res.json(user);
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

// Ask Google to drop the grant entirely. Revoking a refresh token invalidates
// every access token minted from it, so one call covers both. Best-effort: a
// failure here must not block the local erase, or a user could be stuck unable
// to delete their data because Google is having a bad day.
async function revokeGoogleGrant(token: string): Promise<void> {
  if (!token) return;
  await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }),
  });
}

// Permanent account deletion. Every User relation in the schema is declared
// onDelete: Cascade, so one delete takes sheets, snapshots, change history,
// widgets, webhooks, share links, scheduled reports and notification logs with
// it. Guarded by typing the account email so a stray click can't fire it.
const deleteLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5 });

router.delete("/me", deleteLimiter, requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const { confirm } = req.body as { confirm?: string };

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, refreshToken: true, accessToken: true },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  // Case-insensitive so the confirmation isn't a typing test, but it must be
  // this account's own address.
  if ((confirm ?? "").trim().toLowerCase() !== user.email.toLowerCase()) {
    res.status(400).json({ error: "Type your account email exactly to confirm deletion" });
    return;
  }

  try {
    const refresh = user.refreshToken ? decrypt(user.refreshToken) : "";
    await revokeGoogleGrant(refresh || decrypt(user.accessToken));
  } catch (err) {
    console.error("Google token revoke failed during account deletion:", err);
  }

  await prisma.user.delete({ where: { id: userId } });
  req.session = null;
  res.json({ ok: true });
});

export default router;
