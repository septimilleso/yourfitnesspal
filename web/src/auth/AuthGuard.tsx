import { useEffect, useState } from "react";
import { Navigate, Outlet } from "react-router-dom";

import { checkAuth } from "../api/client";

type Status = "checking" | "authenticated" | "unauthenticated";

/**
 * Route guard: probes a protected endpoint before rendering nested routes.
 * Redirects to /login when the probe reports no valid session.
 */
function AuthGuard() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let cancelled = false;

    checkAuth()
      .then((authenticated) => {
        if (!cancelled) {
          setStatus(authenticated ? "authenticated" : "unauthenticated");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("unauthenticated");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

export default AuthGuard;
