import { useState } from "react";
import { Link } from "react-router-dom";

import { useAdminUsers, useCreateUser, useDeleteUser, type AdminUser } from "../../api/admin";

function DeleteUserRow({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const deleteUser = useDeleteUser();

  return (
    <form
      className="mt-3 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        deleteUser.mutate(
          { id: user.id, confirm_username: confirmText },
          { onSuccess: onDone },
        );
      }}
    >
      <p className="text-sm text-red-700">
        Digita <strong>{user.username}</strong> per confermare l’eliminazione.
      </p>
      <input
        className="field"
        autoCapitalize="none"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        required
      />
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onDone}>Annulla</button>
        <button
          className="btn-primary flex-1 bg-red-600 hover:bg-red-700"
          disabled={deleteUser.isPending || confirmText !== user.username}
        >
          {deleteUser.isPending ? "Eliminazione..." : "Elimina"}
        </button>
      </div>
      {deleteUser.isError && <p role="alert" className="text-sm text-red-700">{deleteUser.error.message}</p>}
    </form>
  );
}

export default function AdminUsersPage() {
  const users = useAdminUsers();
  const create = useCreateUser();
  const [showForm, setShowForm] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<"admin" | "user">("user");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  return <div>
    <header className="app-header"><div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3"><Link to="/settings" className="btn-ghost">‹ Indietro</Link><h1 className="text-[17px] font-semibold">Gestione utenti</h1><button className="btn-primary" onClick={() => setShowForm(true)}>+ Nuovo</button></div></header>
    <main className="mx-auto max-w-2xl space-y-4 p-4">
      {showForm && <form className="card space-y-3 p-4" onSubmit={(event) => { event.preventDefault(); create.mutate({ username, display_name: displayName, role }, { onSuccess: (result) => { setTemporaryPassword(result.temporary_password); setShowForm(false); setUsername(""); setDisplayName(""); } }); }}>
        <h2 className="font-semibold">Nuovo utente</h2><input className="field" placeholder="Username" autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} required /><input className="field" placeholder="Nome visualizzato" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <select className="field" value={role} onChange={(e) => setRole(e.target.value as "admin" | "user")}><option value="user">Utente</option><option value="admin">Amministratore</option></select>
        <div className="flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowForm(false)}>Annulla</button><button className="btn-primary flex-1" disabled={create.isPending}>Crea</button></div>
        {create.isError && <p role="alert" className="text-sm text-red-700">{create.error.message}</p>}
      </form>}
      {temporaryPassword && <section role="dialog" className="card border-brand-200 bg-brand-50 p-4"><h2 className="font-semibold">Password temporanea</h2><p className="mt-2 rounded bg-white p-2 font-mono text-sm">{temporaryPassword}</p><p className="mt-2 text-sm">Comunicala ora all’utente: non sarà più visibile.</p><button className="btn-primary mt-3" onClick={() => setTemporaryPassword(null)}>Ho copiato</button></section>}
      {users.isLoading && <p className="text-sm text-slate-500">Caricamento utenti...</p>}
      {users.isError && <p role="alert" className="text-sm text-red-700">Impossibile caricare gli utenti.</p>}
      <section className="card divide-y divide-slate-100 overflow-hidden">{users.data?.map((user: AdminUser) => <article className="p-4" key={user.id}>
        <div className="flex items-center justify-between">
          <div><p className="font-semibold">{user.display_name}</p><p className="text-sm text-slate-500">@{user.username}</p></div>
          <div className="flex items-center gap-1 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1">{user.role === "admin" ? "Admin" : "Utente"}</span>
            {!user.is_active && <span className="rounded-full bg-red-100 px-2 py-1 text-red-700">Disattivato</span>}
            {!user.totp_enabled && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">2FA da configurare</span>}
            <button
              type="button"
              className="btn-ghost text-red-600"
              onClick={() => setDeletingUserId(deletingUserId === user.id ? null : user.id)}
            >
              Elimina
            </button>
          </div>
        </div>
        {deletingUserId === user.id && <DeleteUserRow user={user} onDone={() => setDeletingUserId(null)} />}
      </article>)}</section>
    </main>
  </div>;
}
