import { useEffect } from "react";
import { LocalNotifications } from "@capacitor/local-notifications";
import { useNavigate } from "react-router-dom";

import { getSnapshot, subscribe } from "./gymStore";
import { isNative } from "./platform";
import { installNotificationSound, syncRestNotification } from "./restNotifications";

/** Ponte tra lo stato locale della palestra e le notifiche locali. Nel browser non rende nulla e non chiama plugin. */
export default function NativeBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNative()) return;
    void installNotificationSound();

    // Solo ciò che sta nella notifica conta: nome, fine del riposo e scarto d'orologio. Serie e sync non la riprogrammano.
    let lastKey: string | undefined;
    const syncFromStore = () => {
      const { active, clockOffsetMs } = getSnapshot();
      const workout = active?.workout ?? null;
      const key = JSON.stringify([workout?.name ?? null, workout?.rest_ends_at ?? null, clockOffsetMs]);
      if (key === lastKey) return;
      lastKey = key;
      syncRestNotification(workout, clockOffsetMs).catch(() => undefined);
    };

    // All'avvio con un riposo nello stato caricato la notifica si ricostruisce; senza attivo non c'è nulla da programmare.
    // Se il caricamento arriva dopo il mount, lo store notifica e la sincronizzazione parte da lì.
    if (getSnapshot().active !== null) syncFromStore();
    const unsubscribe = subscribe(syncFromStore);

    const listener = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
      const url = action.notification.extra?.url;
      if (typeof url === "string") navigate(url);
    });

    return () => {
      unsubscribe();
      void listener.then((handle) => handle.remove());
    };
  }, [navigate]);

  return null;
}
