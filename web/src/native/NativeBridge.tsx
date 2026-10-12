import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useNavigate } from "react-router-dom";

import { gymKeys, type Workout } from "../api/gym";
import { isNative } from "./platform";
import { installNotificationSound, syncRestNotification } from "./restNotifications";

function isActiveWorkoutKey(queryKey: readonly unknown[]): boolean {
  return JSON.stringify(queryKey) === JSON.stringify(gymKeys.active);
}

/** Ponte tra la cache React Query e le notifiche locali. Nel browser non rende nulla e non chiama plugin. */
export default function NativeBridge() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;
    void installNotificationSound();

    // Ogni risposta che aggiorna il workspace attivo (serie, ±15 s, Salta, fine, annullamento) passa da qui.
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "success") return;
      if (!isActiveWorkoutKey(event.query.queryKey)) return;
      const workout = event.query.state.data as Workout | null | undefined;
      if (workout === undefined) return;
      syncRestNotification(workout).catch(() => undefined);
    });

    const listener = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const url = action.notification.extra?.url;
      if (typeof url === "string") navigate(url);
    });

    return () => {
      unsubscribe();
      void listener.then((handle) => handle.remove());
    };
  }, [navigate, queryClient]);

  return null;
}
