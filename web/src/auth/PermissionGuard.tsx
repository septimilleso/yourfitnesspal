import { Navigate, Outlet } from "react-router-dom";

import type { Permission } from "../lib/permissions";
import { useHasPermission } from "./AuthContext";

export default function PermissionGuard({ permission }: { permission: Permission }) {
  return useHasPermission(permission) ? <Outlet /> : <Navigate to="/" replace />;
}
