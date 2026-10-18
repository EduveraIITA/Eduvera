import type { QueryClient, QueryKey } from "@tanstack/react-query";

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
  "gate.visitor.updated",
  "gate.movement.updated",
  "organization.structure.updated",
  "departure.updated",
  "transport.updated",
  "staff.access.updated",
  "day_plan.updated",
  "people.updated",
  "coordination.updated",
  "diary.updated",
  "attendance.updated",
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
  "administration.updated",
  "campus_event.updated",
  "fees.updated",
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
  "gate",
  "organization",
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
  "coordination",
  "student.home",
  "student.attendance",
  "student.eligibility",
  "student.diary",
  "student.leave",
  "student.timetable",
  "parent.home",
  "parent.attendance",
  "parent.diary",
  "parent.leave",
  "parent.timetable",
  "teacher.home",
  "teacher.attendance",
  "principal.home",
  "principal.attendance",
  "principal.attendance-history",
  "principal.timetable",
  "principal.administration",
  "calendar",
  "notifications",
  "campus-events",
  "fees",
  "notices",
  "requests",
  "attention",
  "messages",
] as const;

export type RefreshTarget = (typeof REFRESH_TARGETS)[number];

interface SchoolEventPayload {
  student_id?: string;
  class_section_id?: string;
  date?: string;
  refresh?: RefreshTarget[];
}

export interface SchoolEventEnvelope {
  id: string;
  type: string;
  created_at: string;
  payload: SchoolEventPayload;
}

export interface QueryInvalidation {
  queryKey: QueryKey;
  exact?: boolean;
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
  "gate.visitor.updated": ["gate", "notifications"],
  "gate.movement.updated": ["gate"],
  "organization.structure.updated": ["organization"],
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
  "administration.updated": ["principal.administration", "principal.timetable", "principal.home", "teacher.home", "student.home", "student.timetable", "parent.home", "parent.timetable"],
  "campus_event.updated": ["campus-events", "student.home", "parent.home", "teacher.home", "principal.home", "notifications"],
  "fees.updated": ["fees", "campus-events"],
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

export const FULL_SYNC_INVALIDATIONS: readonly QueryInvalidation[] = [
  { queryKey: ["gate"] },
  { queryKey: ["gate-admin"] },
  { queryKey: ["gate-approvals"] },
  { queryKey: ["organization"] },
  { queryKey: ["departure"] },
  { queryKey: ["analytics"] },
  { queryKey: ["staff-operations"] },
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
  { queryKey: ["teacher-attendance"] },
  { queryKey: ["principal-home"] },
  { queryKey: ["principal-insights"] },
  { queryKey: ["principal-register"] },
  { queryKey: ["principal-register-history"] },
  { queryKey: ["principal-timetable"] },
  { queryKey: ["office", "administration"] },
  { queryKey: ["office", "fees"] },
  { queryKey: ["office", "family-fees"] },
  { queryKey: ["calendar"] },
  { queryKey: ["notifications"] },
  { queryKey: ["campus-events"] },
  { queryKey: ["campus-event"] },
  { queryKey: ["campus-event-register"] },
  { queryKey: ["campus-event-finance"] },
  { queryKey: ["notices"] },
  { queryKey: ["notice"] },
  { queryKey: ["requests"] },
  { queryKey: ["attention"] },
  { queryKey: ["chat"] },
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
  if (!isOptionalString(value.student_id) || !isOptionalString(value.class_section_id) || !isOptionalString(value.date)) {
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
  const payload = parsePayload(value.payload);
  if (!payload) return null;
  return { id: value.id, type: value.type, created_at: value.created_at, payload };
}

function parentInvalidations(area: "home" | "attendance" | "diary" | "leave" | "timetable", studentId?: string) {
  if (!studentId) return [{ queryKey: ["school", "parent", area] }];
  return [
    { queryKey: ["school", "parent", area, studentId] },
    { queryKey: ["school", "parent", area, "default"] },
  ];
}

function scopedOperationsInvalidation(
  root: "teacher-home" | "teacher-attendance" | "principal-home" | "principal-register" | "principal-register-history",
  payload: SchoolEventPayload,
): QueryInvalidation {
  if (root === "teacher-attendance" || root === "principal-register" || root === "principal-register-history") {
    const queryKey = payload.class_section_id
      ? payload.date
        ? [root, payload.class_section_id, payload.date]
        : [root, payload.class_section_id]
      : [root];
    return { queryKey };
  }
  return { queryKey: payload.date ? [root, payload.date] : [root] };
}

function invalidationsForTarget(target: RefreshTarget, payload: SchoolEventPayload, userId?: string): QueryInvalidation[] {
  switch (target) {
    case "departure": return [{ queryKey: ["departure"] }];
    case "organization": return [{ queryKey: ["organization"] }];
    case "staff.access": return [{queryKey:["staff-operations"]},{queryKey:["roles"]},{queryKey:["assessments"]},{queryKey:["academic-reports"]}];
    case "staff-operations":
    case "principal.staff":
    case "teacher.leave": return [{ queryKey: ["staff-operations"] }];
    case "gate": return [{ queryKey: ["gate"] }, { queryKey: ["gate-admin"] }, { queryKey: ["gate-approvals"] }];
    case "governance": return [{ queryKey: ["governance"] }];
    case "restricted-care": return [{ queryKey: ["restricted-care"] }];
    case "institution-activation": return [{ queryKey: ["institution-activation"] }];
    case "assessments": return [{ queryKey: ["assessments"] }, { queryKey: ["assessment-detail"] }];
    case "academic-reports": return [{ queryKey: ["academic-reports"] }, { queryKey: ["grading-scheme"] }, { queryKey: ["report-batch"] }];
    case "teacher-feedback": return [{ queryKey: ["teacher-feedback"] }];
    case "day-plans": return [{ queryKey: ["school", "day-plans"] }];
    case "people": return [{ queryKey: ["school", "people"] }, { queryKey: ["school", "parent"] }];
    case "coordination": return [{ queryKey: ["school", "coordination"] }];
    case "student.home": return [{ queryKey: ["school", "student", "home"] }];
    case "student.attendance": return [{ queryKey: ["school", "student", "attendance"] }];
    case "student.eligibility": return [{ queryKey: ["school", "student", "eligibility"] }];
    case "student.diary": return [{ queryKey: ["school", "student", "diary"] }];
    case "student.leave": return [{ queryKey: ["school", "student", "leave"] }];
    case "student.timetable": return [{ queryKey: ["school", "student", "timetable"] }];
    case "parent.home": return parentInvalidations("home", payload.student_id);
    case "parent.attendance": return parentInvalidations("attendance", payload.student_id);
    case "parent.diary": return parentInvalidations("diary", payload.student_id);
    case "parent.leave": return parentInvalidations("leave", payload.student_id);
    case "parent.timetable": return parentInvalidations("timetable", payload.student_id);
    case "teacher.home": return [scopedOperationsInvalidation("teacher-home", payload)];
    case "teacher.attendance": return [scopedOperationsInvalidation("teacher-attendance", payload)];
    case "principal.home": return [scopedOperationsInvalidation("principal-home", payload), { queryKey: ["principal-insights"] }];
    case "principal.attendance": return [scopedOperationsInvalidation("principal-register", payload)];
    case "principal.attendance-history": return [scopedOperationsInvalidation("principal-register-history", payload)];
    case "principal.timetable": return [{ queryKey: ["principal-timetable"] }];
    case "principal.administration": return [{ queryKey: ["office", "administration"] }];
    case "fees": return [{ queryKey: ["office", "fees"] }, { queryKey: ["office", "family-fees"] }, { queryKey: ["campus-event-finance"] }];
    case "calendar": return [{ queryKey: ["calendar"] }];
    case "notifications": return [{ queryKey: userId ? ["notifications", userId] : ["notifications"] }];
    case "campus-events": return [{ queryKey: ["campus-events"] }, { queryKey: ["campus-event"] }, { queryKey: ["campus-event-register"] }, { queryKey: ["campus-event-finance"] }];
    case "notices": return [{ queryKey: ["notices"] }, { queryKey: ["notice"] }];
    case "requests": return [{ queryKey: ["requests"] }];
    case "attention": return [{ queryKey: ["attention"] }];
    case "messages": return [{ queryKey: ["chat"] }];
  }
}

function deduplicateInvalidations(invalidations: readonly QueryInvalidation[]): QueryInvalidation[] {
  const unique = new Map<string, QueryInvalidation>();
  for (const invalidation of invalidations) {
    const key = `${invalidation.exact === true ? "exact" : "prefix"}:${JSON.stringify(invalidation.queryKey)}`;
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
  const targets = envelope.payload.refresh ?? defaultsByType[expectedType];
  const invalidations = targets.flatMap((target) => invalidationsForTarget(target, envelope.payload, userId));
  if (expectedType.startsWith("attendance.") || ["staff.access.updated", "people.updated", "administration.updated", "timetable.updated"].includes(expectedType)) {
    invalidations.push({ queryKey: ["analytics"] });
  }
  // Requests and Attention are server-owned projections over many domains. Any
  // accepted school event may complete, create, or reprioritise an exact item.
  // Refresh both so an already-open queue and its navigation badges cannot drift.
  invalidations.push({ queryKey: ["requests"] });
  invalidations.push({ queryKey: ["attention"] });
  return { envelope, invalidations: deduplicateInvalidations(invalidations), usedFallback: false };
}

export interface InvalidationBatcher {
  enqueue: (invalidations: readonly QueryInvalidation[]) => void;
  flush: () => Promise<void>;
  cancel: () => void;
}

export function createInvalidationBatcher(queryClient: QueryClient, delayMs = 75): InvalidationBatcher {
  const pending = new Map<string, QueryInvalidation>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = async () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const invalidations = [...pending.values()];
    pending.clear();
    await Promise.all(invalidations.map(({ queryKey, exact }) => queryClient.invalidateQueries({ queryKey, exact })));
  };

  return {
    enqueue(invalidations) {
      for (const invalidation of invalidations) {
        const key = `${invalidation.exact === true ? "exact" : "prefix"}:${JSON.stringify(invalidation.queryKey)}`;
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
