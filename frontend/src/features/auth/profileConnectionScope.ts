import type { MembershipRole, SchoolMembership } from "./AuthContext";

/**
 * Compatibility vocabulary used only by the existing calendar and messaging
 * connection APIs. These values select an API read model; they are not roles,
 * responsibilities, or frontend authorization evidence.
 */
export type ProfileConnectionAudience = "principal" | "teacher" | "parent" | "student";

const audienceForMembership: Record<MembershipRole, ProfileConnectionAudience | null> = {
  admin: "principal",
  staff: "teacher",
  guardian: "parent",
  student: "student",
  member: null,
};

const membershipForPathSegment: Partial<Record<string, MembershipRole>> = {
  principal: "admin",
  teacher: "staff",
  parent: "guardian",
  student: "student",
};

export function profileConnectionAudience(
  memberships: readonly SchoolMembership[],
  returnPathname: string,
): ProfileConnectionAudience | null {
  const requestedRole = membershipForPathSegment[returnPathname.split("/")[1] ?? ""];
  const membership = (requestedRole
    ? memberships.find((item) => item.role === requestedRole)
    : undefined) ?? memberships[0];
  return membership ? audienceForMembership[membership.role] : null;
}
