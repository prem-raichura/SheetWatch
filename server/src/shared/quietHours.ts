import type { UserPrefs } from "./prefs";

type QuietHours = UserPrefs["notifications"]["quietHours"];

// Local wall-clock minutes for `now` in the given IANA timezone.
// Invalid/empty timezone → null (quiet hours then fail open to delivery).
function localMinutes(now: Date, timezone: string): number | null {
  if (!timezone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return (hour % 24) * 60 + minute;
  } catch {
    return null;
  }
}

function parseHHMM(s: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// True when `now` falls inside the user's quiet window. Over-midnight windows
// (22:00 → 07:00) are supported.
export function isQuiet(quiet: QuietHours, timezone: string, now = new Date()): boolean {
  if (!quiet.enabled) return false;
  const mins = localMinutes(now, timezone);
  if (mins === null) return false;
  const start = parseHHMM(quiet.start);
  const end = parseHHMM(quiet.end);
  if (start === null || end === null || start === end) return false;
  if (start < end) return mins >= start && mins < end;
  return mins >= start || mins < end;
}

// UTC Date of the next quiet-window end — when queued notifications flush.
export function nextQuietEnd(quiet: QuietHours, timezone: string, now = new Date()): Date {
  const end = parseHHMM(quiet.end) ?? 0;
  const mins = localMinutes(now, timezone);
  if (mins === null) return now;
  let deltaMinutes = end - mins;
  if (deltaMinutes <= 0) deltaMinutes += 24 * 60;
  // Round to the top of the minute so flushes line up predictably.
  const target = new Date(now.getTime() + deltaMinutes * 60_000);
  target.setSeconds(0, 0);
  return target;
}
