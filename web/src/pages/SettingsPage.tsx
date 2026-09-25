import { Link } from "react-router-dom";

import { useMe } from "../auth/AuthContext";
import ModeSwitch from "../components/ModeSwitch";

/** Settings page, opened from the header gear: account and admin links. */
function SettingsPage() {
  const { data: me } = useMe();

  return (
    <div className="settings-page">
      <header className="app-header">
        <ModeSwitch />
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-[17px] font-semibold text-slate-900">Impostazioni</h1>
        </div>
      </header>

      <div className="mx-auto max-w-2xl space-y-4 p-4">
        <section className="card divide-y divide-slate-100 overflow-hidden">
          <Link className="row flex justify-between" to="/account"><span>Account</span><span className="text-slate-500">{me?.username} ›</span></Link>
          {me?.role === "admin" && <Link className="row flex justify-between" to="/admin/users"><span>Gestione utenti</span><span>›</span></Link>}
        </section>
      </div>
    </div>
  );
}

export default SettingsPage;
