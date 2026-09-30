import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getPushConfig } from "../api/push";
import {
  disableRestAlerts,
  enableRestAlerts,
  isDeviceSubscribed,
  pushAvailability,
} from "../lib/push";

const permissionMessage = "Permesso notifiche negato: riabilitalo in Impostazioni iOS › Notifiche › YFP";

export default function RestAlertSetting() {
  const config = useQuery({ queryKey: ["push-config"], queryFn: getPushConfig });
  const availability = pushAvailability();
  const [subscribed, setSubscribed] = useState(false);
  const [deviceChecked, setDeviceChecked] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let current = true;
    isDeviceSubscribed()
      .then((active) => {
        if (current) setSubscribed(active);
      })
      .catch(() => {
        if (current) setError("Impossibile verificare l'avviso su questo dispositivo.");
      })
      .finally(() => {
        if (current) setDeviceChecked(true);
      });
    return () => {
      current = false;
    };
  }, []);

  const unavailableMessage =
    availability === "unsupported"
      ? "Installa YFP nella schermata Home per attivare l'avviso"
      : availability === "denied" || permissionDenied
        ? permissionMessage
        : config.data?.public_key === null
          ? "Avviso non configurato sul server"
          : "";
  const disabled =
    pending ||
    !deviceChecked ||
    config.isLoading ||
    config.isError ||
    availability !== "available" ||
    permissionDenied ||
    !config.data?.public_key;

  async function updateSubscription() {
    if (disabled) return;
    setPending(true);
    setError("");
    try {
      if (subscribed) {
        await disableRestAlerts();
        setSubscribed(false);
      } else {
        const result = await enableRestAlerts(config.data!.public_key!);
        if (result === "denied") {
          setPermissionDenied(true);
        } else {
          setSubscribed(true);
        }
      }
    } catch {
      setError("Impossibile aggiornare l'avviso. Controlla la connessione e riprova.");
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
        {config.isError && (
          <p role="alert" className="text-sm text-red-700">
            Impossibile caricare la configurazione dell'avviso.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
