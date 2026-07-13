// Unread tracking for the Activity feed: last-seen timestamp in localStorage,
// with a window event so the AppLayout badge updates in the same tab.
const KEY = "sheetwatch:lastSeenChangesAt";
export const SEEN_EVENT = "sheetwatch:seen";

export function getLastSeen(): string {
  return localStorage.getItem(KEY) ?? new Date(0).toISOString();
}

export function markSeen(): void {
  localStorage.setItem(KEY, new Date().toISOString());
  window.dispatchEvent(new Event(SEEN_EVENT));
}
