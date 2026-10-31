import type { SchoolMembership } from "./AuthContext";

type SchoolOption = Pick<SchoolMembership, "school_id" | "school_name">;

/** Presentation only: callers retain every membership when checking authority. */
export function schoolOptions(memberships: readonly SchoolOption[]): SchoolOption[] {
  const options = new Map<string, SchoolOption>();
  for (const membership of memberships) {
    if (!options.has(membership.school_id)) {
      options.set(membership.school_id, {
        school_id: membership.school_id,
        school_name: membership.school_name,
      });
    }
  }
  return [...options.values()];
}
