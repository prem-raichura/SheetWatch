import { useState } from "react";
import { api } from "../lib/api";
import { useToast } from "../components/Toast";
import { Sheet } from "../types";

export const SNOOZE_OPTIONS = [
  { label: "1 hour", ms: 3_600_000 },
  { label: "8 hours", ms: 28_800_000 },
  { label: "24 hours", ms: 86_400_000 },
];

// Shared check/pause/snooze/delete handlers for a sheet, used by both the
// card (SheetRow) and the compact list row (SheetListRow).
export function useSheetActions(sheet: Sheet, onUpdated: () => void) {
  const toast = useToast();
  const [checking, setChecking] = useState(false);
  const [pausing, setPausing] = useState(false);

  const paused = sheet.paused;
  const errored = !!sheet.errorMessage;
  const snoozed = !!sheet.snoozedUntil && new Date(sheet.snoozedUntil) > new Date();

  const checkNow = async () => {
    setChecking(true);
    try {
      await api.post(`/api/sheets/${sheet.id}/check`);
      toast.info(`Checking “${sheet.label}” now…`);
      setTimeout(onUpdated, 2500);
    } catch {
      toast.error("Couldn’t queue a check");
    } finally {
      setChecking(false);
    }
  };

  const togglePause = async () => {
    setPausing(true);
    try {
      await api.patch(`/api/sheets/${sheet.id}`, { paused: !paused });
      toast.success(paused ? "Resumed watching" : "Paused");
      onUpdated();
    } catch {
      toast.error("Couldn’t update");
    } finally {
      setPausing(false);
    }
  };

  const snooze = async (until: string | null) => {
    try {
      await api.patch(`/api/sheets/${sheet.id}`, { snoozedUntil: until });
      toast.success(until ? "Notifications snoozed" : "Snooze cleared");
      onUpdated();
    } catch {
      toast.error("Couldn’t update snooze");
    }
  };

  const remove = async () => {
    await api.delete(`/api/sheets/${sheet.id}`);
    toast.success(`Stopped watching “${sheet.label}”`);
    onUpdated();
  };

  return {
    checking,
    pausing,
    paused,
    errored,
    snoozed,
    checkNow,
    togglePause,
    snooze,
    remove,
  };
}
