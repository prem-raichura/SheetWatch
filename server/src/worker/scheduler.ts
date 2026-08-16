import prisma from "../shared/prisma";
import {
  compareQueue,
  pollQueue,
  scheduleIntegrityCheck,
  scheduleSheetPoll,
  unscheduleIntegrityCheck,
  unscheduleSheetPoll,
} from "../shared/queues";

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

// The same reconcile for integrity checks — they're scheduled per check, at
// each check's own interval, exactly like sheet polls. The Vercel API can't
// touch Redis, so a check created, disabled, deleted or re-intervalled in the
// UI reaches BullMQ only through this.
export async function ensureAllIntegrityJobs(): Promise<ReconcileResult> {
  const groups = await prisma.comparisonGroup.findMany({
    where: { enabled: true },
    select: { id: true, checkInterval: true },
  });

  const existing = await compareQueue().getJobSchedulers(0, -1, true);
  const byKey = new Map(existing.map((s) => [s.key, s]));

  let added = 0;
  let retimed = 0;

  for (const group of groups) {
    const current = byKey.get(`integrity:${group.id}`);
    if (!current) {
      await scheduleIntegrityCheck(group);
      added++;
    } else if (Number(current.every) !== group.checkInterval * 1000) {
      await scheduleIntegrityCheck(group);
      retimed++;
    }
  }

  const wanted = new Set(groups.map((g) => `integrity:${g.id}`));
  const stale = existing.filter((s) => s.key.startsWith("integrity:") && !wanted.has(s.key));
  for (const s of stale) {
    await unscheduleIntegrityCheck(s.key.slice("integrity:".length));
  }

  // Retire the old single global sweep from earlier deploys.
  const legacy = existing.find((s) => s.key === "compare:sweep");
  if (legacy) await compareQueue().removeJobScheduler("compare:sweep").catch(() => {});

  return { active: groups.length, added, retimed, removed: stale.length };
}
