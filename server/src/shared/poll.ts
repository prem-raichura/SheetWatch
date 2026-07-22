import { Prisma } from "@prisma/client";
import prisma from "./prisma";
import { oauthClientFor } from "./google/oauthClient";
import { fetchScoped, indexToColumn, rangeStartColumn } from "./google/sheets";
import { withRetry, isTransient } from "./google/retry";
import { hashGrid, diffGridSmart } from "./google/diff";
import { writeSnapshot } from "./snapshots";
import { normalizeToV2, matchRulesV2 } from "./rules";
import { digestSuppressesEmail } from "./digest";
import { CellChange } from "./types";
import { dispatch, safeHost, type ChannelTarget } from "./notify/dispatch";
import { checkKpiThresholds } from "./kpi";
import { recomputeGroupsForSheet } from "./compare";
import { publishRealtime } from "./realtime";

// Polls a single sheet. Returns the new ChangeLog id if the sheet changed,
// null otherwise. Does NOT send notifications — the caller decides how
// (queue on the worker, inline on the Vercel cron).
export async function pollSheet(sheetId: string): Promise<string | null> {
  const sheet = await prisma.sheet.findUnique({
    where: { id: sheetId },
    include: { user: true },
  });

  if (!sheet) return null;
  if (sheet.paused || sheet.archivedAt) return null;

  try {
    const auth = oauthClientFor(sheet.user);
    const rows = await withRetry(() => fetchScoped(sheet, auth));
    const newHash = hashGrid(rows);

    await prisma.sheet.update({
      where: { id: sheetId },
      data: { lastCheckedAt: new Date(), errorMessage: null },
    });

    if (newHash === sheet.lastHash) return null;

    const oldRows = (sheet.lastSnapshot as string[][] | null) ?? [];
    const { changes, summary } = diffGridSmart(oldRows, rows);

    const changeLog = await prisma.changeLog.create({
      data: {
        sheetId,
        summary,
        details: changes as unknown as Prisma.InputJsonValue,
      },
    });

    await prisma.sheet.update({
      where: { id: sheetId },
      data: { lastHash: newHash, lastSnapshot: rows },
    });

    // Point-in-time history for the timeline view and KPI sparklines.
    await writeSnapshot(sheetId, newHash, rows).catch((err) =>
      console.error(`Snapshot write failed for ${sheetId}:`, err?.message ?? err)
    );

    // Threshold alerts on pinned cells fire on state change, not every poll.
    await checkKpiThresholds(sheet, rows).catch((err) =>
      console.error(`KPI threshold check failed for ${sheetId}:`, err?.message ?? err)
    );

    // Re-diff any comparison groups referencing this sheet (master or target) —
    // its stored snapshot now reflects the new values, and new suggestions
    // notify. No-op when the sheet has no groups.
    await recomputeGroupsForSheet(sheetId).catch((err) =>
      console.error(`Compare recompute failed for ${sheetId}:`, err?.message ?? err)
    );

    // Nudge any live UI to refetch immediately — even when notifications are
    // suppressed/snoozed, the change should still surface in the app.
    void publishRealtime(sheet.userId, {
      kind: "change",
      sheetId,
      changeLogId: changeLog.id,
      label: sheet.label,
      summary,
    });

    return changeLog.id;
  } catch (err: any) {
    const status = err?.code ?? err?.status ?? err?.response?.status;

    if (status === 401 || status === 403) {
      await prisma.sheet.update({
        where: { id: sheetId },
        data: { errorMessage: "Access denied — re-authorize in the app." },
      });
      return null;
    }

    if (status === 404) {
      await prisma.sheet.update({
        where: { id: sheetId },
        data: { errorMessage: "Sheet not found or deleted." },
      });
      return null;
    }

    if (isTransient(err)) {
      // Retries exhausted. Record and move on — lastCheckedAt advances so the
      // cron path doesn't hot-loop on this sheet, and BullMQ doesn't retry-spam.
      await prisma.sheet.update({
        where: { id: sheetId },
        data: {
          lastCheckedAt: new Date(),
          errorMessage: `Google API temporarily unreachable${typeof status === "number" ? ` (HTTP ${status})` : ""} — will retry next poll.`,
        },
      });
      return null;
    }

    throw err;
  }
}

// Sheet column letters touched by a set of cell changes. Cell refs ("R3C2")
// are relative to the fetched grid, so offset by the range's start column.
function changedColumns(details: CellChange[], range: string): Set<string> {
  const offset = rangeStartColumn(range);
  const cols = new Set<string>();
  for (const change of details) {
    const m = /^R\d+C(\d+)$/.exec(change.cell);
    if (m) cols.add(indexToColumn(offset + Number(m[1]) - 1));
  }
  return cols;
}

export async function notifySheetChange(
  sheetId: string,
  changeLogId: string
): Promise<void> {
  const [sheet, changeLog] = await Promise.all([
    prisma.sheet.findUnique({
      where: { id: sheetId },
      include: {
        user: { include: { pushSubs: true } },
        webhooks: { include: { webhook: true } },
      },
    }),
    prisma.changeLog.findUnique({ where: { id: changeLogId } }),
  ]);

  if (!sheet || !changeLog) return;

  // Snoozed: change is logged, notification suppressed.
  if (sheet.snoozedUntil && sheet.snoozedUntil > new Date()) return;

  // Column filter: only notify when a watched column changed. Note: in
  // rowmatch mode row indices refer to the filtered rows, but column letters
  // are still correct, so the filter stays valid.
  const details = (changeLog.details as unknown as CellChange[]) ?? [];
  if (sheet.alertColumns.length > 0) {
    const touched = changedColumns(details, sheet.range);
    if (!sheet.alertColumns.some((c) => touched.has(c))) return;
  }

  // Value rules: groups are ORed, conditions within a group ANDed. Matched
  // groups may narrow delivery to specific channels; sheet-level toggles and
  // attached webhooks remain the outer gate.
  const rules = normalizeToV2(sheet.alertRules);
  const match = matchRulesV2(details, rules, sheet.range);
  if (!match.matched) return;

  const routed = (channel: string) =>
    match.channels === "all" || match.channels.has(channel);

  const payload = {
    title: `${sheet.label} changed`,
    body: changeLog.summary,
    url: `https://docs.google.com/spreadsheets/d/${sheet.spreadsheetId}`,
  };

  const targets: ChannelTarget[] = [];

  // Digest users get one summary email instead of per-change mail;
  // push and webhooks stay instant.
  if (sheet.notifyEmail && routed("email") && !digestSuppressesEmail(sheet.user.digest)) {
    targets.push({ channel: "email", email: sheet.user.email });
  }

  if (sheet.notifyPush && routed("push")) {
    for (const sub of sheet.user.pushSubs) {
      targets.push({
        channel: "push",
        sub: { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        endpointHost: safeHost(sub.endpoint),
      });
    }
  }

  for (const link of sheet.webhooks) {
    if (!routed(`webhook:${link.webhookId}`)) continue;
    if (link.webhook.kind === "telegram") {
      targets.push({
        channel: "telegram",
        chatId: link.webhook.url,
        label: link.webhook.label,
      });
    } else {
      targets.push({
        channel: "webhook",
        kind: link.webhook.kind,
        url: link.webhook.url,
        label: link.webhook.label,
      });
    }
  }

  if (targets.length === 0) return;

  await dispatch({
    userId: sheet.userId,
    sheetId: sheet.id,
    changeLogId,
    payload,
    targets,
  });
}
