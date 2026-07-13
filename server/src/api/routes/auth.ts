import crypto from "crypto";
import { Router } from "express";
import { google } from "googleapis";
import prisma from "../../shared/prisma";
import { encrypt } from "../../shared/crypto";
import { requireAuth } from "../middleware/requireAuth";

const router = Router();

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  // Full Drive scope: read-only covers listing/watching, but moving a
  // spreadsheet to trash from the Sheets page needs write access.
  "https://www.googleapis.com/auth/drive",
  "email",
  "profile",
];

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

router.get("/google", (req, res) => {
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

router.get("/google/callback", async (req, res) => {
  const code = req.query.code as string | undefined;
  if (!code) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=no_code`);
    return;
  }

  const expectedState = req.session?.oauthState as string | undefined;
  if (!expectedState || req.query.state !== expectedState) {
    res.redirect(`${process.env.FRONTEND_URL}/login?error=state_mismatch`);
    return;
  }
  delete req.session!.oauthState;

  try {
    const client = makeOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.id || !profile.email) throw new Error("Missing profile data");
    if (!tokens.access_token) throw new Error("No access token returned");

    const user = await prisma.user.upsert({
      where: { googleId: profile.id },
      create: {
        googleId: profile.id,
        email: profile.email,
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token ?? ""),
        tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
      },
      update: {
        email: profile.email,
        accessToken: encrypt(tokens.access_token),
        ...(tokens.refresh_token && { refreshToken: encrypt(tokens.refresh_token) }),
        tokenExpiry: new Date(tokens.expiry_date ?? Date.now() + 3600_000),
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
    select: { id: true, email: true, googleId: true, createdAt: true, digest: true, digestHour: true },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(user);
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
    select: { id: true, email: true, googleId: true, createdAt: true, digest: true, digestHour: true },
  });
  res.json(user);
});

router.post("/logout", (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

export default router;
