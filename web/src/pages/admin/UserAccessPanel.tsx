import {
  type AdminUser,
  useAdminMcpConnections,
  useAdminPermissions,
  useRevokeAdminMcpConnections,
  useUpdateUser,
} from "../../api/admin";
import { formatDateTime } from "../../lib/format";
import type { Permission } from "../../lib/permissions";

export default function UserAccessPanel({ user }: { user: AdminUser }) {
  const permissions = useAdminPermissions();
  const update = useUpdateUser();
  const connections = useAdminMcpConnections(user.id);
  const revokeAll = useRevokeAdminMcpConnections(user.id);

  function toggle(key: Permission, enabled: boolean) {
    const next = enabled ? [...user.permissions, key] : user.permissions.filter((p) => p !== key);
    update.mutate({ id: user.id, permissions: next });
  }

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Permessi</legend>
        {user.role === "admin" ? (
          <p className="text-sm text-slate-500">Gli amministratori hanno tutti i permessi.</p>
        ) : (
          permissions.data?.map((permission) => (
            <label key={permission.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={user.permissions.includes(permission.key)}
                disabled={update.isPending}
                onChange={(event) => toggle(permission.key, event.target.checked)}
              />
              {permission.label}
            </label>
          ))
        )}
        {update.isError && <p role="alert" className="text-sm text-red-700">{update.error.message}</p>}
      </fieldset>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Connessioni AI</h3>
        {connections.data?.length === 0 && (
          <p className="text-sm text-slate-500">Nessuna connessione attiva.</p>
        )}
        <ul className="space-y-1">
          {connections.data?.map((connection) => (
            <li key={connection.client_id} className="text-sm text-slate-700">
              {connection.client_name} · ultimo uso {connection.last_used_at ? formatDateTime(connection.last_used_at) : "mai"}
            </li>
          ))}
        </ul>
        {Boolean(connections.data?.length) && (
          <button
            type="button"
            className="btn-secondary text-red-700"
            disabled={revokeAll.isPending}
            onClick={() => revokeAll.mutate()}
          >
            Revoca tutte
          </button>
        )}
      </div>
    </div>
  );
}
