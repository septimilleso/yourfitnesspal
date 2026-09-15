import { Navigate, Outlet } from "react-router-dom";
import { useMe } from "./AuthContext";

export default function AdminGuard() {
  const { data: me } = useMe();
  return me?.role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}
