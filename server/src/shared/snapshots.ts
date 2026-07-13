import { Prisma } from "@prisma/client";
import prisma from "./prisma";

const KEEP_RECENT = 50;
const DETAIL_WINDOW_DAYS = 7;

// Record a point-in-time copy of the watched grid. Called on every detected
// change from pollSheet().
export async function writeSnapshot(
  sheetId: string,
  hash: string,
  rows: string[][]
): Promise<void> {
  await prisma.snapshot.create({
    data: { sheetId, hash, rows: rows as unknown as Prisma.InputJsonValue },
  });
}

// Retention: keep the newest KEEP_RECENT per sheet; beyond the recent
// window keep at most one snapshot per day.
export async function pruneSnapshots(): Promise<number> {
  const sheets = await prisma.snapshot.groupBy({
    by: ["sheetId"],
    _count: { _all: true },
    having: { sheetId: { _count: { gt: KEEP_RECENT } } },
  });

  let deleted = 0;
  for (const { sheetId } of sheets) {
    const snapshots = await prisma.snapshot.findMany({
      where: { sheetId },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });

    const cutoff = Date.now() - DETAIL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const toDelete: string[] = [];
    const seenDays = new Set<string>();

    snapshots.forEach((snap, i) => {
      if (i < KEEP_RECENT) return;
      if (snap.createdAt.getTime() >= cutoff) return;
      const day = snap.createdAt.toISOString().slice(0, 10);
      if (seenDays.has(day)) toDelete.push(snap.id);
      else seenDays.add(day);
    });

    if (toDelete.length > 0) {
      const res = await prisma.snapshot.deleteMany({ where: { id: { in: toDelete } } });
      deleted += res.count;
    }
  }
  return deleted;
}
