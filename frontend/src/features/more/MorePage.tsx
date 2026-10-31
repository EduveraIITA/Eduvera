import { Navigate } from "react-router-dom";

/**
 * Persona-prefixed More routes are a bounded bookmark bridge only. The
 * responsibility-composed workspace owns the catalogue at `/more`; this file
 * deliberately contains no role-derived tools, authority or alternate shell.
 */
function CanonicalMoreRedirect() {
  return <Navigate to="/more" replace />;
}

export function ParentMoreRoute() {
  return <CanonicalMoreRedirect />;
}

export function TeacherMoreRoute() {
  return <CanonicalMoreRedirect />;
}

export function PrincipalMoreRoute() {
  return <CanonicalMoreRedirect />;
}

export const MoreContent = CanonicalMoreRedirect;
