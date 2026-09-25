import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { recordActivity } from "../api/queries";

/** Tells the API the app was opened today (streak counter): once on mount
 * and each time the app comes back to the foreground, which also covers a
 * PWA left open across midnight. Failures are ignored; the next foreground
 * retries. */
function ActivityTracker() {
  const queryClient = useQueryClient();

  useEffect(() => {
    function ping() {
      recordActivity()
        .then(() => queryClient.invalidateQueries({ queryKey: ["streak"] }))
        .catch(() => {});
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") ping();
    }
    ping();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [queryClient]);

  return null;
}

export default ActivityTracker;
