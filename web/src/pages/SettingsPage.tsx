import { Link } from "react-router-dom";

import { useHasPermission, useMe } from "../auth/AuthContext";
import ModeSwitch from "../components/ModeSwitch";
import NativeRestAlertSetting from "../components/NativeRestAlertSetting";
import OfflineIndicator from "../components/OfflineIndicator";
import RestAlertSetting from "../components/RestAlertSetting";
import { isNative } from "../native/platform";

/** Settings page, opened from the header gear: account and admin links. */
function SettingsPage() {
  const { data: me } = useMe();
  const canUseWorkouts = useHasPermission("workouts.use");

  return (
    <div className="settings-page">
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          {canUseWorkouts ? (
            <h1 className="text-[17px] font-semibold text-slate-900">Impostazioni</h1>
          ) : (
            // Senza la palestra il puntino non sta in ModeSwitch: va accanto al titolo.
            <div className="flex items-center gap-1">
              <h1 className="text-[17px] font-semibold text-slate-900">Impostazioni</h1>
              {/* Margine negativo: il pulsante da 44 px non allunga la riga del titolo (line-height circa 25,5 px). */}
              <OfflineIndicator className="relative -my-2.5 inline-flex shrink-0" />
            </div>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <section className="card divide-y divide-slate-100 overflow-hidden">
          <Link className="row flex justify-between" to="/account"><span>Account</span><span className="text-slate-500">{me?.username} ›</span></Link>
          {me?.role === "admin" && <Link className="row flex justify-between" to="/admin/users"><span>Gestione utenti</span><span>›</span></Link>}
        </section>
        {canUseWorkouts && (isNative() ? <NativeRestAlertSetting /> : <RestAlertSetting />)}
      </div>
    </div>
  );
}

export default SettingsPage;
