import { z } from "zod";
const revisionRef = z.object({ id: z.uuid(), revision: z.number().int().positive() }).strict();
export const leaveReviewRouteBasisSchema = z.object({
    rule: revisionRef, office: revisionRef, appointment: revisionRef, person: revisionRef,
    sources: z.array(revisionRef).min(1).max(100),
}).strict().refine(value => new Set(value.sources.map(source => source.id)).size === value.sources.length, "Each authority source may occur only once.");
export function canonicalLeaveReviewRouteBasis(value) {
    const ref = ({ id, revision }) => ({ id, revision });
    return { rule: ref(value.rule), office: ref(value.office), appointment: ref(value.appointment), person: ref(value.person),
        sources: value.sources.map(ref).sort((left, right) => left.id.localeCompare(right.id)) };
}
export function leaveReviewRouteBasis(authority) {
    return canonicalLeaveReviewRouteBasis(authority);
}
export function matchesLeaveReviewRouteBasis(value, authority) {
    const parsed = leaveReviewRouteBasisSchema.safeParse(value);
    return parsed.success && JSON.stringify(canonicalLeaveReviewRouteBasis(parsed.data)) === JSON.stringify(leaveReviewRouteBasis(authority));
}
//# sourceMappingURL=staff-leave-review-routing.contracts.js.map