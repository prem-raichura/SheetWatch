import { Router } from "express";
import { Prisma } from "@prisma/client";
import prisma from "../../shared/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { mergePrefs, applyPrefsPatch } from "../../shared/prefs";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { prefs: true },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }
  res.json(mergePrefs(user.prefs));
});

router.patch("/", requireAuth, async (req, res) => {
  const userId = req.session!.userId as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { prefs: true },
  });
  if (!user) {
    res.status(401).json({ error: "User not found" });
    return;
  }

  const current = mergePrefs(user.prefs);
  const { prefs, error } = applyPrefsPatch(current, req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  await prisma.user.update({
    where: { id: userId },
    data: { prefs: prefs as unknown as Prisma.InputJsonValue },
  });
  res.json(prefs);
});

export default router;
