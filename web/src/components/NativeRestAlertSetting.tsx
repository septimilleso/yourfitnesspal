import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LocalNotifications } from "@capacitor/local-notifications";

import { gymKeys, type Workout } from "../api/gym";
import {
  cancelRestNotification,
  getRestAlertsEnabled,
  setRestAlertsEnabled,
  syncRestNotification,
} from "../native/restNotifications";

const permissionMessage = "Permesso notifiche negato: riabilitalo in Impostazioni iOS › Notifiche › YFP";

/** Avviso fine riposo nell'IPA: notifiche locali al posto del Web Push. Stessa struttura visiva di RestAlertSetting. */
export default function NativeRestAlertSetting() {
  const queryClient = useQueryClient();
  const [subscribed, setSubscribed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    Promise.all([getRestAlertsEnabled(), LocalNotifications.checkPermissions()])
      .then(([alertsOn, { display }]) => {
        if (!current) return;
        setPermissionDenied(display === "denied");
        setSubscribed(alertsOn && display === "granted");
      })
      .catch(() => {
        if (current) setError("Impossibile verificare l'avviso su questo dispositivo.");
      })
      .finally(() => {
        if (current) setChecked(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const unavailableMessage = permissionDenied ? permissionMessage : "";
  const disabled = pending || !checked || permissionDenied;

  async function updateSubscription() {
    if (disabled) return;
    setPending(true);
    setError("");
    try {
      if (subscribed) {
        await setRestAlertsEnabled(false);
        await cancelRestNotification();
        setSubscribed(false);
      } else {
        const { display } = await LocalNotifications.requestPermissions();
        if (display !== "granted") {
          setPermissionDenied(true);
          return;
        }
        await setRestAlertsEnabled(true);
        // Il workspace attivo può essere già in cache: lo programmiamo subito, senza aspettare la prossima risposta.
        const workout = queryClient.getQueryData<Workout | null>(gymKeys.active);
        if (workout !== undefined) await syncRestNotification(workout);
        setSubscribed(true);
      }
    } catch {
      setError("Impossibile aggiornare l'avviso. Riprova.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-2">
      <div className="card space-y-3 p-4">
        <label className="flex items-center justify-between gap-4">
          <span className="font-medium text-slate-900">Avviso fine riposo</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="Avviso fine riposo"
            className="h-5 w-5 accent-blue-600"
            checked={subscribed}
            disabled={disabled}
            onChange={() => void updateSubscription()}
          />
        </label>
        <p className="text-sm text-slate-600">
          Per sentirlo in palestra con un Focus attivo, aggiungi YFP alle app consentite del Focus
          (Impostazioni iOS › Focus).
        </p>
        {unavailableMessage && <p className="text-sm text-slate-600">{unavailableMessage}</p>}
        {pending && <p className="text-sm text-slate-500">Aggiornamento...</p>}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
