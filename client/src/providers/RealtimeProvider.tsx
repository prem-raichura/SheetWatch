import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { connectRealtime, type RealtimeEvent, type RealtimeStatus } from "@/lib/realtime";
import { useToast } from "@/components/Toast";
import { usePrefs } from "./PrefsProvider";
import { playSound } from "@/lib/sound";

// Window event fired on every realtime change so data hooks can refetch
// instantly. Hooks keep their 30s polling as a fallback.
export const REALTIME_EVENT = "sw:realtime";

interface RealtimeContextValue {
  status: RealtimeStatus;
}

const RealtimeContext = createContext<RealtimeContextValue>({ status: "off" });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { prefs } = usePrefs();
  const [status, setStatus] = useState<RealtimeStatus>("off");
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Keep the latest sound choices reachable from the stable onEvent callback.
  const soundRef = useRef(prefs.notifications.sound);
  soundRef.current = prefs.notifications.sound;
  const compareSoundRef = useRef(prefs.notifications.compareSound);
  compareSoundRef.current = prefs.notifications.compareSound;

  useEffect(() => {
    const cleanup = connectRealtime({
      getToken: () => api.get<{ token: string | null; url: string | null }>("/api/realtime/token"),
      onStatus: setStatus,
      onEvent: (event: RealtimeEvent) => {
        window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: event }));
        if (event.kind === "suggestions") {
          toastRef.current.info(`${event.label}: ${event.summary}`);
          playSound(compareSoundRef.current); // compare suggestions sound
        } else if (event.kind === "kpi-alert") {
          toastRef.current.info(`${event.label}: ${event.summary}`);
          playSound(soundRef.current); // grouped with tracking/sheet alerts
        } else {
          toastRef.current.info(`${event.label} changed`);
        }
      },
    });
    return cleanup;
  }, []);

  return <RealtimeContext.Provider value={{ status }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeContextValue {
  return useContext(RealtimeContext);
}
