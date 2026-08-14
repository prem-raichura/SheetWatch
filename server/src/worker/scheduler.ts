import prisma from "../shared/prisma";
import { pollQueue, scheduleSheetPoll, unscheduleSheetPoll } from "../shared/queues";

export interface ReconcileResult {
  active: number;
  added: number;
  retimed: number;
  removed: number;
}

// Re-derive every repeatable poll job from the database.
//
// In the split deployment this is the *only* thing that schedules sheets. The
// API runs on Vercel with WORKER_MODE unset, so its scheduleSheetPoll and
// unscheduleSheetPoll calls are no-ops and it never opens a Redis connection —
// which means a sheet added, paused, archived, deleted or re-intervalled
// through the UI is invisible to BullMQ until this runs.
//
// Only writes when something actually differs, so calling it on a timer costs
// one query plus one ZRANGE and never churns a scheduler or pushes back its
// next run.
export async function ensureAllSheetJobs(): Promise<ReconcileResult> {
  const sheets = await prisma.sheet.findMany({
    where: { paused: false, archivedAt: null },
    select: { id: true, pollInterval: true },
  });

  const existing = await pollQueue().getJobSchedulers(0, -1, true);
  const byKey = new Map(existing.map((s) => [s.key, s]));

  let added = 0;
  let retimed = 0;

  for (const sheet of sheets) {
    const current = byKey.get(`poll:${sheet.id}`);
    if (!current) {
      await scheduleSheetPoll(sheet);
      added++;
    } else if (Number(current.every) !== sheet.pollInterval * 1000) {
      // upsertJobScheduler replaces the interval in place.
      await scheduleSheetPoll(sheet);
      retimed++;
    }
  }

  // Drop schedulers whose sheet is gone, paused or archived — without this a
  // paused sheet keeps getting polled forever, since the Vercel API can't
  // remove the scheduler itself.
  const wanted = new Set(sheets.map((s) => `poll:${s.id}`));
  const stale = existing.filter((s) => s.key.startsWith("poll:") && !wanted.has(s.key));
  for (const s of stale) {
    await unscheduleSheetPoll(s.key.slice("poll:".length));
  }

  return { active: sheets.length, added, retimed, removed: stale.length };
}
