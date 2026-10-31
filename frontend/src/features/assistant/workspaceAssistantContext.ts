import type { AuthContextValue } from "../auth/AuthContext";
import type { AssistantPortal } from "./context";

type AssistantAuth = Pick<AuthContextValue, "user" | "memberships"> | undefined;

/** A global account role cannot widen the currently selected campus relationship. */
export function workspaceAssignedWorkOnly(auth: AssistantAuth): boolean {
  const campusId = auth?.user?.active_school_id;
  if (!campusId) return false;
  const memberships = auth?.memberships.filter(item => item.school_id === campusId) ?? [];
  return memberships.length > 0 && memberships.every(item => item.access_scope === "assigned_work");
}

/**
 * Resolve the existing assistant contract from the authenticated workspace.
 * The person never chooses a portal: identity and active institution context
 * select the perspective until the assistant API accepts responsibility scopes
 * directly.
 */
export function workspaceAssistantPortal(auth: AssistantAuth): AssistantPortal | null {
  if (workspaceAssignedWorkOnly(auth)) return null;
  const accountRole = auth?.user?.role;
  if (accountRole === "parent" || accountRole === "student") {
    return accountRole;
  }
  if (accountRole === "staff") return "teacher";
  if (accountRole === "admin") return "principal";

  const roles = new Set(auth?.memberships.map((membership) => membership.role) ?? []);
  if (roles.has("staff")) return "teacher";
  if (roles.has("admin")) return "principal";
  if (roles.has("guardian")) return "parent";
  if (roles.has("student")) return "student";
  return null;
}
