import { useEffect } from "react";
import { REALTIME_EVENT } from "../providers/RealtimeProvider";

// Calls the given refetch whenever a realtime change event arrives, so data
// updates instantly instead of waiting for the next poll.
export function useRealtimeRefetch(refetch: () => void) {
  useEffect(() => {
    const handler = () => refetch();
    window.addEventListener(REALTIME_EVENT, handler);
    return () => window.removeEventListener(REALTIME_EVENT, handler);
  }, [refetch]);
}
