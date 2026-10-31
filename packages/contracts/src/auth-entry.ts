/** Shared entry routing. Source identity is rechecked by the destination owner. */
export interface AuthEntryState {
  status: string;
  memberships: Array<{school_id:string;role:string;access_scope?:string}>;
  companyOperator?: boolean;
  user?: {id:string;active_school_id?:string|null;email_verified?:boolean}|null;
  executionEnvironment?: {mode:string;institutionId?:string|null};
  onboarding?: {
    status:string; guidance?:string|null;
    guidance_resume?:{kind:string;path:string;requires_recheck:boolean;actor_user_id:string;school_id:string}|null;
    resume?:{step?:string;goal?:string|null;path:string;continuation?:{kind:string;requires_recheck:boolean;actor_user_id:string;school_id:string;source_id:string;source_revision:number}}|null;
  };
}
export function authDestination(auth: AuthEntryState, options: { resumeUnfinishedSetup?: boolean } = {}) {
  if (auth.status !== "authenticated") return "/login";
  if (auth.user?.email_verified === false) return "/account/security";
  if (auth.companyOperator) return "/company";
  if (auth.onboarding?.status === "workspace_required" || auth.onboarding?.status === "purpose_required") return "/onboarding/start";
  if (auth.memberships.length === 0) return "/onboarding/start";
  const resume = auth.onboarding?.resume;
  const continuation = resume?.continuation;
  // A server-vetted unfinished setup may resume its exact source. Ordinary
  // operating entry stays Today, and a retained Live summary never selects a run.
  if (options.resumeUnfinishedSetup !== false && auth.executionEnvironment?.mode !== "simulation" && auth.onboarding?.status === "ready"
    && resume?.step === "first_use" && resume.goal === "timetable" && continuation?.kind === "activity_plan"
    && Boolean(auth.user?.id) && continuation.requires_recheck === true && continuation.actor_user_id === auth.user?.id
    && (!auth.user?.active_school_id || auth.user.active_school_id === continuation.school_id)
    && (!auth.executionEnvironment?.institutionId || auth.executionEnvironment.institutionId === continuation.school_id)
    && auth.memberships.some(item => item.school_id === continuation.school_id)
    && Number.isSafeInteger(continuation.source_revision) && continuation.source_revision > 0) {
    try {
      const url = new URL(resume.path, "https://thatcampus.invalid");
      const keys = ["plan", "plan_revision", "date", "section"];
      if (resume.path.startsWith("/") && !resume.path.startsWith("//")
        && url.origin === "https://thatcampus.invalid" && url.pathname === "/areas/timetable/planning" && !url.hash
        && [...url.searchParams.keys()].every(key => keys.includes(key))
        && keys.every(key => url.searchParams.getAll(key).length === 1)
        && url.searchParams.get("plan") === continuation.source_id
        && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(continuation.source_id)
        && /^[1-9]\d{0,8}$/.test(url.searchParams.get("plan_revision") ?? "")
        && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "")
        && url.searchParams.get("section") === "drafts") return `${url.pathname}${url.search}`;
    } catch { /* Invalid retained context falls back to the shared home. */ }
  }
  if (options.resumeUnfinishedSetup !== false && auth.executionEnvironment?.mode !== "simulation" && auth.onboarding?.status === "ready"
    && resume?.step === "first_use" && resume.goal === "assignments" && continuation?.kind === "learning_assignment"
    && Boolean(auth.user?.id) && continuation.requires_recheck === true && continuation.actor_user_id === auth.user?.id
    && (!auth.user?.active_school_id || auth.user.active_school_id === continuation.school_id)
    && (!auth.executionEnvironment?.institutionId || auth.executionEnvironment.institutionId === continuation.school_id)
    && auth.memberships.some(item => item.school_id === continuation.school_id)
    && Number.isSafeInteger(continuation.source_revision) && continuation.source_revision > 0) {
    try {
      const url = new URL(resume.path, "https://thatcampus.invalid");
      const scope = url.searchParams.get("scope");
      const contextKey = scope === "offering" ? "offering_id" : scope === "class" ? "class_section_id" : null;
      const keys = ["scope", "assignment", "revision", contextKey];
      const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
      if (contextKey && resume.path.length <= 180 && resume.path.startsWith("/") && !resume.path.startsWith("//")
        && url.origin === "https://thatcampus.invalid" && url.pathname === "/areas/messages/assignments" && !url.hash
        && [...url.searchParams.keys()].every(key => keys.includes(key))
        && keys.every(key => key !== null && url.searchParams.getAll(key).length === 1)
        && url.searchParams.get("assignment") === continuation.source_id && uuid.test(continuation.source_id)
        && uuid.test(url.searchParams.get(contextKey) ?? "")
        && /^[1-9]\d*$/.test(url.searchParams.get("revision") ?? "")
        && Number.isSafeInteger(Number(url.searchParams.get("revision")))) return `${url.pathname}${url.search}`;
    } catch { /* Invalid retained context falls back to the shared home. */ }
  }
  const guide = auth.onboarding?.guidance_resume;
  if (options.resumeUnfinishedSetup !== false && auth.executionEnvironment?.mode !== "simulation"
    && auth.onboarding?.status === "ready" && auth.onboarding.guidance === "whole_campus"
    && guide?.kind === "whole_campus" && guide.path === "/more/setup/whole-campus" && guide.requires_recheck === true
    && Boolean(auth.user?.id) && guide.actor_user_id === auth.user?.id
    && auth.user?.active_school_id === guide.school_id
    && (!auth.executionEnvironment?.institutionId || auth.executionEnvironment.institutionId === guide.school_id)
    && auth.memberships.some(item => item.school_id === guide.school_id && item.role === "admin" && item.access_scope !== "assigned_work")) {
    return "/more/setup/whole-campus";
  }
  return "/today";
}
