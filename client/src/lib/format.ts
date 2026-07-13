import type { UserPrefs } from "./prefs";

type TimePrefs = UserPrefs["time"];

const DEFAULT_TIME: TimePrefs = { hour12: true, relative: true };

export function formatTimeAgo(iso: string, time: TimePrefs = DEFAULT_TIME): string {
  if (!time.relative) return formatDateTime(iso, time);
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return formatDateTime(iso, time);
}

export function formatDateTime(iso: string, time: TimePrefs = DEFAULT_TIME): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: time.hour12,
  });
}

export function formatTime(iso: string, time: TimePrefs = DEFAULT_TIME): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: time.hour12,
  });
}
