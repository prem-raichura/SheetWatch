import { Router } from "express";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { sendEmail, emailConfigured } from "../../shared/notify/email";

const router = Router();

// Verify email delivery end-to-end without waiting for a sheet change.
router.post("/test-email", requireAuth, async (req, res) => {
  if (!emailConfigured()) {
    res.status(400).json({
      error:
        "Email isn’t configured on the server. Set RESEND_API_KEY, or SMTP_HOST + SMTP_USER + SMTP_PASS in server/.env, then restart.",
    });
    return;
  }

  const userId = req.session!.userId as string;
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { email: true },
  });

  try {
    await sendEmail(user.email, {
      title: "SheetWatch test email",
      body: "Email notifications are working 🎉",
      url: process.env.FRONTEND_URL ?? "https://docs.google.com",
    });
    res.json({ ok: true, to: user.email });
  } catch (err: any) {
    console.error("Test email failed:", err?.message ?? err);
    res.status(502).json({ error: err?.message ?? "Email delivery failed" });
  }
});

export default router;
