import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { feeQueryInvalidations } from "../office/feeQueryKeys";

const STAFF_OPERATION_EVENT_TYPES = [
  "staff.responsibility.offered",
  "staff.responsibility.active",
  "staff.responsibility.accepted",
  "staff.responsibility.declined",
  "staff.leave.submitted",
  "staff.leave.approved",
  "staff.leave.rejected",
  "staff.leave.withdrawn",
  "staff.coverage.offered",
  "staff.coverage.accepted",
  "staff.coverage.declined",
] as const;

const GOVERNANCE_EVENT_TYPES = [
  "governance.policy.submitted",
  "governance.policy.published",
  "governance.policy.rejected",
  "governance.policy.acknowledged",
] as const;

const RESTRICTED_CARE_EVENT_TYPES = [
  "restricted_care.case.opened",
  "restricted_care.case.reassigned",
  "restricted_care.case.triage",
  "restricted_care.case.active",
  "restricted_care.case.closed",
  "restricted_care.case.entry_added",
  "restricted_care.reporting.assessed",
  "restricted_care.external_report.recorded",
] as const;

export const SCHOOL_EVENT_TYPES = [
  "campus_assets.updated",
  "campus_scenes.updated",
  "campus_scenes.draft_saved",
  "campus_scenes.published",
  "campus_scenes.reopened",
  "campus_scenes.image_uploaded",
  "organization.structure.updated",
  "gate.visitor.updated",
  "gate.visit_arrangement.updated",
  "gate.visit_shared.updated",
  "departure.updated",
  "transport.updated",
  "staff.access.updated",
  "day_plan.updated",
  "people.updated",
  "coordination.updated",
  "diary.updated",
  "attendance.updated",
  "attendance.participation.updated",
  "attendance.register.draft",
  "attendance.register.submitted",
  "attendance.register.locked",
  "attendance.register.unlocked",
  "attendance.register.reopened",
  "attendance.register.overdue",
  "notification.created",
  "leave.updated",
  "timetable.updated",
  "calendar.updated",
  "campus_dates.published",
  "campus_dates.corrected",
  "campus_dates.cancelled",
  "administration.updated",
  "institution.setup.updated",
  "campus_event.updated",
  "fees.updated",
  "resources.updated",
  "facilities.updated",
  "accommodation.updated",
  "dining.updated",
  "assessment.updated",
  "academic_report.updated",
  "teacher_feedback.updated",
  "notice.updated",
  "chat.updated",
  ...STAFF_OPERATION_EVENT_TYPES,
  ...GOVERNANCE_EVENT_TYPES,
  ...RESTRICTED_CARE_EVENT_TYPES,
  "InstitutionActivated",
] as const;

export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export const REFRESH_TARGETS = [
  "campus-assets",
  "campus-scenes",
  "organization",
  "gate",
  "gate-visits",
  "departure",
  "staff.access",
  "staff-operations",
  "principal.staff",
  "teacher.leave",
  "governance",
  "restricted-care",
  "institution-activation",
  "assessments",
  "academic-reports",
  "teacher-feedback",
  "day-plans",
  "people",
  "people.participants",
  "activities",
  "activities.catalogue",
  "attendance",
  "workspace",
  "today",
  "coordination",
  "student.home",
  "student.attendance",
  "student.eligibility",
  "student.diary",
  "learning-assignments",
  "teaching-sessions",
  "finance-arrangements",
  "student.leave",
  "student.timetable",
  "parent.home",
  "parent.attendance",
  "parent.diary",
  "parent.leave",
  "parent.timetable",
  "teacher.home",
  "teacher.class-updates",
  "teacher.attendance",
  "attendance-model",
  "attendance-continuity",
  "principal.home",
  "principal.attendance",
  "principal.attendance-history",
  "principal.student-leave",
  "principal.timetable",
  "principal.administration",
  "calendar",
  "notifications",
  "campus-events",
  "fees",
  "resources",
  "facilities",
  "accommodation",
  "dining",
  "notices",
  "requests",
  "attention",
  "messages",
  "campus-view",
] as const;

export type RefreshTarget = (typeof REFRESH_TARGETS)[number];

interface SchoolEventPayload {
  student_id?: string;
  class_section_id?: string;
  session_id?: string;
  date?: string;
  refresh?: RefreshTarget[];
}

export interface SchoolEventEnvelope {
  id: string;
  type: string;
  created_at: string;
  school_id?: string;
  namespace_id?: string;
  payload: SchoolEventPayload;
}

export interface SchoolEventScope {
  institutionId?: string;
  namespaceId?: string;
}

/** Foreign-context events must be ignored, not turned into a full cache refresh. */
export function schoolEventMatchesScope(envelope: SchoolEventEnvelope, scope: SchoolEventScope): boolean {
  return (!scope.institutionId || envelope.school_id === scope.institutionId)
    && (!scope.namespaceId || envelope.namespace_id === scope.namespaceId);
}

export interface QueryInvalidation {
  queryKey: QueryKey;
  exact?: boolean;
  /** A domain root below the selected Live/run cache prefix. */
  environmentScoped?: boolean;
}

interface EventResolution {
  envelope: SchoolEventEnvelope | null;
  invalidations: QueryInvalidation[];
  usedFallback: boolean;
}

const targetSet = new Set<string>(REFRESH_TARGETS);

function eventDefaults<T extends readonly SchoolEventType[]>(
  types: T,
  targets: readonly RefreshTarget[],
): Record<T[number], readonly RefreshTarget[]> {
  return Object.fromEntries(types.map((type) => [type, targets])) as Record<T[number], readonly RefreshTarget[]>;
}

const defaultsByType = {
  "campus_assets.updated": ["campus-assets"],
  "campus_scenes.updated": ["campus-scenes", "campus-view"],
  "campus_scenes.draft_saved": ["campus-scenes"],
  "campus_scenes.published": ["campus-scenes"],
  "campus_scenes.reopened": ["campus-scenes"],
  "campus_scenes.image_uploaded": ["campus-scenes"],
  "organization.structure.updated": ["organization"],
  "gate.visitor.updated": ["gate", "notifications"],
  "gate.visit_arrangement.updated": ["gate-visits", "workspace", "attention"],
  "gate.visit_shared.updated": ["gate-visits", "workspace", "attention"],
  "departure.updated": ["departure", "student.home", "parent.home", "teacher.home", "principal.home"],
  "transport.updated": ["departure", "student.home", "parent.home", "teacher.home", "principal.home"],
  "staff.access.updated": ["staff.access","teacher.home","teacher.attendance","principal.home"],
  "day_plan.updated": ["day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "notifications"],
  "people.updated": ["people", "teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "parent.home"],
  "coordination.updated": ["coordination", "parent.home", "teacher.home", "principal.home", "notifications"],
  "diary.updated": ["student.home", "student.diary", "parent.home", "parent.diary"],
  "attendance.updated": [
    "student.home",
    "student.attendance",
    "student.eligibility",
    "parent.home",
    "parent.attendance",
    "teacher.home",
    "teacher.attendance",
    "principal.home",
    "principal.attendance",
    "principal.attendance-history",
    "notifications",
  ],
  "attendance.participation.updated": ["activities", "attendance", "workspace", "today"],
  "attendance.register.draft": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "principal.attendance-history"],
  "attendance.register.submitted": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "principal.attendance-history"],
  "attendance.register.locked": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "principal.attendance-history"],
  "attendance.register.unlocked": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "principal.attendance-history"],
  "attendance.register.reopened": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "principal.attendance-history"],
  "attendance.register.overdue": ["teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "notifications"],
  "notification.created": ["notifications"],
  "leave.updated": ["student.home", "student.leave", "parent.home", "parent.leave", "notifications"],
  "timetable.updated": [
    "day-plans",
    "student.home",
    "student.timetable",
    "parent.home",
    "parent.timetable",
    "teacher.home",
    "principal.timetable",
  ],
  "calendar.updated": ["calendar", "day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "principal.timetable", "notifications"],
  "campus_dates.published": ["calendar"],
  "campus_dates.corrected": ["calendar"],
  "campus_dates.cancelled": ["calendar"],
  "administration.updated": ["principal.administration", "principal.timetable", "principal.home", "teacher.home", "student.home", "student.timetable", "parent.home", "parent.timetable"],
  "institution.setup.updated": ["principal.administration", "campus-view"],
  "campus_event.updated": ["campus-events", "student.home", "parent.home", "teacher.home", "principal.home", "notifications"],
  "fees.updated": ["fees", "campus-events", "parent.home"],
  "resources.updated": ["resources", "workspace", "attention"],
  "facilities.updated": ["facilities", "workspace", "attention"],
  "accommodation.updated": ["accommodation", "workspace", "attention"],
  "dining.updated": ["dining", "workspace", "attention", "calendar"],
  "assessment.updated": ["assessments", "teacher.home", "principal.home"],
  "academic_report.updated": ["academic-reports", "teacher.home", "principal.home"],
  "teacher_feedback.updated": ["teacher-feedback", "principal.home"],
  "notice.updated": ["notices", "requests", "notifications", "parent.home", "teacher.home", "principal.home", "attention"],
  "chat.updated": ["messages", "notifications", "attention"],
  ...eventDefaults(STAFF_OPERATION_EVENT_TYPES, ["staff-operations", "teacher.home", "principal.home"]),
  ...eventDefaults(GOVERNANCE_EVENT_TYPES, ["governance"]),
  ...eventDefaults(RESTRICTED_CARE_EVENT_TYPES, ["restricted-care"]),
  InstitutionActivated: ["institution-activation", "principal.home"],
} satisfies Record<SchoolEventType, readonly RefreshTarget[]>;

// Refresh hints describe the producer's directly affected domain screens. Some
// read-only projections depend on those domains as well, so they are always
// refreshed here even when an older producer sent an explicit refresh list.
// This keeps the event contract additive without turning the model core into a
// second writable source of truth.
const dependentProjectionsByType: Partial<Record<SchoolEventType, readonly RefreshTarget[]>> = {
  "diary.updated": ["learning-assignments", "teaching-sessions", "workspace"],
  "gate.visitor.updated": ["campus-view"],
  "departure.updated": ["campus-view"],
  "transport.updated": ["campus-view"],
  "staff.access.updated": ["institution-activation", "campus-view", "teaching-sessions", "facilities", "accommodation", "dining"],
  "day_plan.updated": ["teacher.class-updates", "calendar", "campus-view", "teaching-sessions"],
  "people.updated": [
    "staff-operations",
    "student.home",
    "student.attendance",
    "student.eligibility",
    "student.diary",
    "student.leave",
    "student.timetable",
    "calendar",
    "institution-activation",
    "campus-view",
    "facilities",
    "accommodation",
    "dining",
  ],
  "attendance.updated": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.draft": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.submitted": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.locked": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.unlocked": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.reopened": ["attendance-model", "attendance-continuity", "campus-view"],
  "attendance.register.overdue": ["attendance-model", "attendance-continuity", "campus-view"],
  "leave.updated": ["principal.student-leave"],
  "timetable.updated": ["calendar", "institution-activation", "campus-view", "activities", "workspace", "teaching-sessions"],
  "calendar.updated": ["campus-view"],
  "administration.updated": ["calendar", "institution-activation", "campus-view"],
  "institution.setup.updated": ["campus-view", "accommodation", "dining", "campus-scenes"],
  "campus_event.updated": ["calendar", "campus-view", "activities", "attendance", "workspace", "today"],
  // Parent Home owns a fee-ledger projection. Older fee producers may send a
  // narrower explicit refresh list, so this dependent projection is additive.
  "fees.updated": ["parent.home", "principal.home", "finance-arrangements", "workspace"],
  "resources.updated": ["resources", "workspace", "attention", "accommodation", "campus-view"],
  "facilities.updated": ["facilities", "workspace", "attention", "campus-view"],
  "accommodation.updated": ["accommodation", "workspace", "attention"],
  "dining.updated": ["calendar", "workspace"],
  "assessment.updated": ["calendar", "activities", "attendance", "workspace", "today"],
};

export const FULL_SYNC_INVALIDATIONS: readonly QueryInvalidation[] = [
  { queryKey: ["gate-visits"], environmentScoped: true },
  { queryKey: ["campus-scenes"], environmentScoped: true },
  { queryKey: ["dining"], environmentScoped: true },
  { queryKey: ["accommodation"], environmentScoped: true },
  { queryKey: ["facilities"], environmentScoped: true },
  { queryKey: ["resources"], environmentScoped: true },
  { queryKey: ["teaching-sessions"], environmentScoped: true },
  { queryKey: ["learning-assignments"], environmentScoped: true },
  { queryKey: ["finance-arrangements"], environmentScoped: true },
  { queryKey: ["activities"], environmentScoped: true },
  { queryKey: ["people.participants"], environmentScoped: true },
  { queryKey: ["people.participation-groups"], environmentScoped: true },
  { queryKey: ["people.connections"], environmentScoped: true },
  { queryKey: ["people.person-groups"], environmentScoped: true },
  { queryKey: ["people.group-catalogue"], environmentScoped: true },
  { queryKey: ["responsibility-workspace"] },
  { queryKey: ["responsibility-attendance"] },
  { queryKey: ["organization"] },
  { queryKey: ["timetable"] },
  { queryKey: ["assigned-classes"] },
  { queryKey: ["assigned-class"] },
  { queryKey: ["gate"] },
  { queryKey: ["gate-admin"] },
  { queryKey: ["gate-approvals"] },
  { queryKey: ["gate-students"] },
  { queryKey: ["departure"] },
  { queryKey: ["analytics"] },
  { queryKey: ["staff-operations"] },
  { queryKey: ["roles"] },
  { queryKey: ["governance"] },
  { queryKey: ["restricted-care"] },
  { queryKey: ["institution-activation"] },
  { queryKey: ["assessments"] },
  { queryKey: ["assessment-detail"] },
  { queryKey: ["academic-reports"] },
  { queryKey: ["grading-scheme"] },
  { queryKey: ["report-batch"] },
  { queryKey: ["teacher-feedback"] },
  { queryKey: ["school"] },
  { queryKey: ["teacher-home"] },
  { queryKey: ["teacher-class-updates"] },
  { queryKey: ["teacher-attendance"] },
  { queryKey: ["attendance-model"] },
  { queryKey: ["attendance-continuity"] },
  { queryKey: ["principal-home"] },
  { queryKey: ["principal-insights"] },
  { queryKey: ["principal-register"] },
  { queryKey: ["principal-register-history"] },
  { queryKey: ["principal-timetable"] },
  { queryKey: ["office", "administration"] },
  { queryKey: ["institution-setup"] },
  { queryKey: ["invitations"], environmentScoped: true },
  { queryKey: ["operating-rules"] },
  { queryKey: ["workflow-rules"] },
  ...feeQueryInvalidations,
  { queryKey: ["calendar"] },
  { queryKey: ["calendar"], environmentScoped: true },
  { queryKey: ["notifications"] },
  { queryKey: ["campus-events"] },
  { queryKey: ["campus-event"] },
  { queryKey: ["campus-event-register"] },
  { queryKey: ["campus-event-finance"] },
  { queryKey: ["campus-event-consent-authorities"] },
  { queryKey: ["notices"] },
  { queryKey: ["notice"] },
  { queryKey: ["notice-references"] },
  { queryKey: ["requests"] },
  { queryKey: ["attention"] },
  { queryKey: ["chat"] },
  { queryKey: ["campus-view"], environmentScoped: true },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

function parsePayload(value: unknown): SchoolEventPayload | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  if (
    !isOptionalString(value.student_id) ||
    !isOptionalString(value.class_section_id) ||
    !isOptionalString(value.session_id) ||
    !isOptionalString(value.date)
  ) {
    return null;
  }
  if (value.refresh !== undefined) {
    if (!Array.isArray(value.refresh) || !value.refresh.every((target) => typeof target === "string" && targetSet.has(target))) {
      return null;
    }
  }
  return {
    student_id: value.student_id,
    class_section_id: value.class_section_id,
    session_id: value.session_id,
    date: value.date,
    refresh: value.refresh as RefreshTarget[] | undefined,
  };
}

export function decodeSchoolEvent(data: string, expectedType: SchoolEventType): SchoolEventEnvelope | null {
  let value: unknown;
  try {
    value = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || typeof value.type !== "string" || value.type !== expectedType) return null;
  if (typeof value.created_at !== "string") return null;
  if (!isOptionalString(value.school_id) || !isOptionalString(value.namespace_id)) return null;
  const payload = parsePayload(value.payload);
  if (!payload) return null;
  return { id: value.id, type: value.type, created_at: value.created_at,
    ...(value.school_id === undefined ? {} : { school_id: value.school_id }),
    ...(value.namespace_id === undefined ? {} : { namespace_id: value.namespace_id }), payload };
}

function parentInvalidations(area: "home" | "attendance" | "diary" | "leave" | "timetable", studentId?: string) {
  if (!studentId) return [{ queryKey: ["school", "parent", area] }];
  return [
    { queryKey: ["school", "parent", area, studentId] },
    { queryKey: ["school", "parent", area, "default"] },
  ];
}

function parentTimetableInvalidations(studentId?: string): QueryInvalidation[] {
  if (!studentId) {
    return [
      { queryKey: ["school", "parent", "timetable"] },
      { queryKey: ["school", "parent", "timetable-summary"] },
    ];
  }
  return [
    ...parentInvalidations("timetable", studentId),
    { queryKey: ["school", "parent", "timetable-summary", studentId] },
    { queryKey: ["school", "parent", "timetable-summary", "default"] },
  ];
}

function parentLeaveInvalidations(): QueryInvalidation[] {
  // Parent leave queries have both detail and calendar shapes. Their student
  // discriminator is not consistently in the same position, so invalidate the
  // canonical area root rather than constructing an incomplete shape.
  return [{ queryKey: ["school", "parent", "leave"] }];
}

function scopedOperationsInvalidation(
  root: "teacher-home" | "principal-home",
  payload: SchoolEventPayload,
): QueryInvalidation {
  return { queryKey: payload.date ? [root, payload.date] : [root] };
}

function invalidationsForTarget(target: RefreshTarget, payload: SchoolEventPayload, userId?: string): QueryInvalidation[] {
  switch (target) {
    case "campus-assets": return [{ queryKey: ["campus-view"], environmentScoped: true }];
    case "teaching-sessions": return [{ queryKey: ["teaching-sessions"], environmentScoped: true }];
    case "learning-assignments": return [{ queryKey: ["learning-assignments"], environmentScoped: true }];
    case "finance-arrangements": return [{ queryKey: ["finance-arrangements"], environmentScoped: true }];
    case "activities":
    case "activities.catalogue": return [{ queryKey: ["activities"], environmentScoped: true }];
    case "people.participants": return [
      { queryKey: ["people.participants"], environmentScoped: true },
      { queryKey: ["people.participation-groups"], environmentScoped: true },
      { queryKey: ["people.connections"], environmentScoped: true },
      { queryKey: ["people.person-groups"], environmentScoped: true },
      { queryKey: ["people.group-catalogue"], environmentScoped: true },
    ];
    case "attendance": return [
      { queryKey: ["activities"], environmentScoped: true },
      { queryKey: ["teacher-attendance"] },
      { queryKey: ["principal-register"] },
      { queryKey: ["principal-register-history"] },
      { queryKey: ["attendance-model"] },
      { queryKey: ["attendance-continuity"] },
    ];
    case "workspace":
    case "today": return [{ queryKey: ["responsibility-workspace"] }];
    case "departure": return [{ queryKey: ["departure"] }];
    case "staff.access": return [{queryKey:["staff-operations"]},{queryKey:["roles"]},{queryKey:["assessments"]},{queryKey:["academic-reports"]}];
    case "staff-operations":
    case "principal.staff":
    case "teacher.leave": return [{ queryKey: ["staff-operations"] }];
    case "gate": return [{ queryKey: ["gate"] }, { queryKey: ["gate-admin"] }, { queryKey: ["gate-approvals"] }];
    case "gate-visits": return [{ queryKey: ["gate-visits"], environmentScoped: true }];
    case "governance": return [{ queryKey: ["governance"] }];
    case "organization": return [{ queryKey: ["organization"] }];
    case "restricted-care": return [{ queryKey: ["restricted-care"] }];
    case "institution-activation": return [{ queryKey: ["institution-activation"] }];
    case "assessments": return [{ queryKey: ["assessments"] }, { queryKey: ["assessment-detail"] }];
    case "academic-reports": return [{ queryKey: ["academic-reports"] }, { queryKey: ["grading-scheme"] }, { queryKey: ["report-batch"] }];
    case "teacher-feedback": return [{ queryKey: ["teacher-feedback"] }];
    case "day-plans": return [{ queryKey: ["school", "day-plans"] }];
    case "people": return [
      { queryKey: ["people.participants"], environmentScoped: true },
      { queryKey: ["people.participation-groups"], environmentScoped: true },
      { queryKey: ["people.connections"], environmentScoped: true },
      { queryKey: ["people.person-groups"], environmentScoped: true },
      { queryKey: ["people.group-catalogue"], environmentScoped: true },
      { queryKey: ["activities"], environmentScoped: true },
      { queryKey: ["school", "people"] },
      { queryKey: ["school", "parent"] },
      { queryKey: ["school", "accessible-students"] },
      { queryKey: ["gate-students"] },
      { queryKey: ["office", "fee-students"] },
      { queryKey: ["campus-event-consent-authorities"] },
      { queryKey: ["invitations"], environmentScoped: true },
      { queryKey: ["notice-references"] },
    ];
    case "coordination": return [{ queryKey: ["school", "coordination"] }];
    case "student.home": return [{ queryKey: ["school", "student", "home"] }];
    case "student.attendance": return [{ queryKey: ["school", "student", "attendance"] }];
    case "student.eligibility": return [{ queryKey: ["school", "student", "eligibility"] }];
    case "student.diary": return [{ queryKey: ["school", "student", "diary"] }];
    case "student.leave": return [
      { queryKey: ["school", "student", "leave"] },
      { queryKey: ["school", "student", "leave-status"] },
    ];
    case "student.timetable": return [
      { queryKey: ["school", "student", "timetable"] },
      { queryKey: ["school", "student", "timetable-summary"] },
    ];
    case "parent.home": return parentInvalidations("home", payload.student_id);
    case "parent.attendance": return parentInvalidations("attendance", payload.student_id);
    case "parent.diary": return parentInvalidations("diary", payload.student_id);
    case "parent.leave": return parentLeaveInvalidations();
    case "parent.timetable": return parentTimetableInvalidations(payload.student_id);
    case "teacher.home": return payload.date
      ? [scopedOperationsInvalidation("teacher-home", payload), { queryKey: ["teacher-home", "timetable"] }]
      : [scopedOperationsInvalidation("teacher-home", payload)];
    case "teacher.class-updates": return [{ queryKey: ["teacher-class-updates"] }];
    // Attendance detail queries include a daily/session discriminator before
    // their record id. Invalidating the canonical root safely covers both that
    // shape and older class-page keys without guessing the producer's mode.
    case "teacher.attendance": return [{ queryKey: ["teacher-attendance"] }];
    case "attendance-model": return [{ queryKey: ["attendance-model"] }];
    case "attendance-continuity": return [{ queryKey: ["attendance-continuity"] }];
    case "principal.home": return [scopedOperationsInvalidation("principal-home", payload), { queryKey: ["principal-insights"] }];
    case "principal.attendance": return [{ queryKey: ["principal-register"] }];
    case "principal.attendance-history": return [{ queryKey: ["principal-register-history"] }];
    case "principal.student-leave": return [{ queryKey: ["school", "principal", "student-leave"] }];
    case "principal.timetable": return [{ queryKey: ["principal-timetable"] }];
    case "principal.administration": return [
      { queryKey: ["office", "administration"] },
      { queryKey: ["institution-setup"] },
      { queryKey: ["invitations"], environmentScoped: true },
      { queryKey: ["operating-rules"] },
      { queryKey: ["workflow-rules"] },
      { queryKey: ["chat", "policy"] },
      { queryKey: ["notice-references"] },
    ];
    case "fees": return [
      ...feeQueryInvalidations,
      { queryKey: ["campus-event-finance"] },
    ];
    case "resources": return [{ queryKey: ["resources"], environmentScoped: true }];
    case "facilities": return [{ queryKey: ["facilities"], environmentScoped: true }];
    case "accommodation": return [{ queryKey: ["accommodation"], environmentScoped: true }];
    case "dining": return [{ queryKey: ["dining"], environmentScoped: true }];
    case "calendar": return [{ queryKey: ["calendar"] }, { queryKey: ["calendar"], environmentScoped: true }];
    case "notifications": return [{ queryKey: userId ? ["notifications", userId] : ["notifications"] }];
    case "campus-events": return [
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["campus-event-consent-authorities"] },
    ];
    case "notices": return [{ queryKey: ["notices"] }, { queryKey: ["notice"] }];
    case "requests": return [{ queryKey: ["requests"] }];
    case "attention": return [{ queryKey: ["attention"] }];
    case "messages": return [{ queryKey: ["chat"] }];
    case "campus-scenes": return [{ queryKey: ["campus-scenes"], environmentScoped: true }];
    case "campus-view": return [{ queryKey: ["campus-view"], environmentScoped: true }];
  }
}

function deduplicateInvalidations(invalidations: readonly QueryInvalidation[]): QueryInvalidation[] {
  const unique = new Map<string, QueryInvalidation>();
  for (const invalidation of invalidations) {
    const key = `${invalidation.environmentScoped ? "environment" : "legacy"}:${invalidation.exact === true ? "exact" : "prefix"}:${JSON.stringify(invalidation.queryKey)}`;
    unique.set(key, invalidation);
  }
  return [...unique.values()];
}

export function resolveSchoolEvent(
  data: string,
  expectedType: SchoolEventType,
  userId?: string,
): EventResolution {
  const envelope = decodeSchoolEvent(data, expectedType);
  if (!envelope) {
    return { envelope: null, invalidations: [...FULL_SYNC_INVALIDATIONS], usedFallback: true };
  }
  const targets = [
    ...(envelope.payload.refresh ?? defaultsByType[expectedType]),
    ...(dependentProjectionsByType[expectedType] ?? []),
  ];
  const invalidations = targets.flatMap((target) => invalidationsForTarget(target, envelope.payload, userId));
  if (
    expectedType.startsWith("attendance.") ||
    [
      "staff.access.updated",
      "people.updated",
      "leave.updated",
      "day_plan.updated",
      "calendar.updated",
      "administration.updated",
      "timetable.updated",
      "assessment.updated",
    ].includes(expectedType)
  ) {
    invalidations.push({ queryKey: ["analytics"] });
  }
  // Requests and Attention are server-owned projections over many domains. Any
  // accepted school event may complete, create, or reprioritise an exact item.
  // Refresh both so an already-open queue and its navigation badges cannot drift.
  // A public informational date cannot create/complete owned work. Refreshing
  // queues for each annual publication would add requests without new facts.
  if (!expectedType.startsWith('campus_dates.')) {
    invalidations.push({ queryKey: ["requests"] });
    invalidations.push({ queryKey: ["attention"] });
  }
  return { envelope, invalidations: deduplicateInvalidations(invalidations), usedFallback: false };
}

export interface InvalidationBatcher {
  enqueue: (invalidations: readonly QueryInvalidation[]) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function createInvalidationBatcher(queryClient: QueryClient, delayMs = 75,
  environmentQueryPrefix: QueryKey = ["execution-environment", "live"]): InvalidationBatcher {
  const pending = new Map<string, QueryInvalidation>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const invalidations = [...pending.values()];
    pending.clear();
    await Promise.all(invalidations.map(({ queryKey, exact, environmentScoped }) => queryClient.invalidateQueries({
      queryKey: environmentScoped ? [...environmentQueryPrefix, ...queryKey] : queryKey, exact,
    })));
  };

  return {
    enqueue(invalidations) {
      for (const invalidation of invalidations) {
        const key = `${invalidation.environmentScoped ? "environment" : "legacy"}:${invalidation.exact === true ? "exact" : "prefix"}:${JSON.stringify(invalidation.queryKey)}`;
        pending.set(key, invalidation);
      }
      if (!timer && pending.size > 0) timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pending.clear();
    },
  };
}
