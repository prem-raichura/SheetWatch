import { useState, useEffect } from "react";
import { subscribeToPush } from "../lib/push";

export function usePushPermission() {
  const [permission, setPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);
    // Permission may already be granted from an earlier session while the
    // server has no (or a stale) subscription — e.g. DB reset or VAPID key
    // change. Re-sync: pushManager.subscribe returns the existing sub and
    // the server upserts it.
    if (Notification.permission === "granted") {
      subscribeToPush().catch(() => {});
    }
  }, []);

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") await subscribeToPush();
  };

  return { permission, requestPermission };
}
