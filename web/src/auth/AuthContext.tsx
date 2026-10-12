import { createContext, type ReactNode, useContext } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe, logout, type Me } from "../api/auth";
import type { Permission } from "../lib/permissions";
import { unsubscribeDeviceOnLogout } from "../lib/push";
import { retryOnlyNetwork } from "../lib/queryClient";
import { isNative } from "../native/platform";
import { cancelRestNotification } from "../native/restNotifications";
import { clearToken } from "../native/session";

const AuthContext = createContext<Me | null | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  return <AuthContext.Provider value={me.data}>{children}</AuthContext.Provider>;
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: getMe, retry: isNative() ? retryOnlyNetwork : false, staleTime: 5 * 60_000 });
}

export function useHasPermission(permission: Permission) {
  const me = useContext(AuthContext);
  return me?.role === "admin" || me?.permissions.includes(permission) || false;
}

export function useIsAdmin() { return useContext(AuthContext)?.role === "admin"; }

export function clearClientCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.clear();
  if ("caches" in window) void window.caches.delete("api-foods-cache").catch(() => undefined);
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await unsubscribeDeviceOnLogout();
    } catch {
      // Continue with logout even if unsubscribe fails
    }
    if (isNative()) {
      // La notifica di riposo pendente non deve suonare dopo l'uscita.
      await cancelRestNotification().catch(() => undefined);
      // Nell'IPA un errore di rete non deve bloccare l'uscita: il token va rimosso comunque.
      try {
        await logout();
      } catch {
        // Continue with logout even if the server cannot be reached
      }
      await clearToken();
    } else {
      await logout();
    }
    clearClientCaches(queryClient);
    navigate("/login", { replace: true });
  };
}

export default AuthContext;
