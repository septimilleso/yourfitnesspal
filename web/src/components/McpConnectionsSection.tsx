import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listConnections, revokeConnection } from "../api/oauth";
import { formatDateTime } from "../lib/format";

const connectionsKey = ["oauth", "connections"] as const;

export default function McpConnectionsSection({ mcpUrl }: { mcpUrl: string }) {
  const queryClient = useQueryClient();
  const connections = useQuery({ queryKey: connectionsKey, queryFn: listConnections });
  const revoke = useMutation({
    mutationFn: (clientId: string) => revokeConnection(clientId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: connectionsKey }),
  });
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    await navigator.clipboard?.writeText(mcpUrl);
    setCopied(true);
  }

  return (
    <section className="space-y-2">
      <h2 className="section-label">Connessioni AI</h2>
      <div className="card space-y-4 p-4">
        <div>
          <p className="text-sm text-slate-600">
            Collega Claude o un altro assistente compatibile MCP al tuo diario.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-slate-50 px-3 py-2 text-sm">
              {mcpUrl}
            </code>
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={() => void copyUrl()}
            >
              {copied ? "Copiato" : "Copia"}
            </button>
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>In Claude apri Impostazioni → Connettori.</li>
            <li>Scegli “Aggiungi connettore personalizzato” e incolla l’URL.</li>
            <li>Accedi con username, password e codice autenticatore, poi autorizza.</li>
          </ol>
        </div>
        <div className="divide-y divide-slate-100 border-t border-slate-100">
          {connections.isLoading && (
            <p className="py-3 text-sm text-slate-500">Caricamento...</p>
          )}
          {connections.isError && (
            <p role="alert" className="py-3 text-sm text-red-700">
              Impossibile caricare le connessioni.
            </p>
          )}
          {connections.data?.length === 0 && (
            <p className="py-3 text-sm text-slate-500">
              Nessun assistente collegato.
            </p>
          )}
          {connections.data?.map((connection) => (
            <div className="flex items-center gap-3 py-3" key={connection.client_id}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{connection.client_name}</p>
                <p className="text-xs text-slate-500">
                  Ultimo uso: {connection.last_used_at ? formatDateTime(connection.last_used_at) : "mai"}
                </p>
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 text-sm text-red-600"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(connection.client_id)}
              >
                Revoca
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
