import prisma from "../shared/prisma";
import { scheduleSheetPoll } from "../shared/queues";

export async function ensureAllSheetJobs(): Promise<void> {
  const sheets = await prisma.sheet.findMany({
    where: { paused: false, archivedAt: null },
    select: { id: true, pollInterval: true },
  });

  await Promise.all(sheets.map((sheet) => scheduleSheetPoll(sheet)));

  console.log(`Scheduled ${sheets.length} sheet poll job(s)`);
}
