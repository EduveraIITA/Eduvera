/** URL state selects a source to recheck; it never grants permission or creates a draft. */
export function activityTimetableSelection(params: URLSearchParams) {
  const plan = params.get("plan");
  const revision = params.get("plan_revision");
  const create = params.get("create");
  const invalid = ["plan", "plan_revision", "create"].some(key => params.getAll(key).length > 1)
    || (plan !== null && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(plan))
    || (revision !== null && (!plan || !/^[1-9]\d{0,8}$/.test(revision)))
    || (create !== null && create !== "activity" && create !== "attendance")
    || Boolean(plan && create);
  return { invalid, plan: invalid ? null : plan, revision: !invalid && revision ? Number(revision) : undefined,
    create: !invalid && (create === "activity" || create === "attendance") ? create : null };
}
