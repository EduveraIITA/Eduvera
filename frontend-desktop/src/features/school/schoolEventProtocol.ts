import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const SCHOOL_EVENT_TYPES = [
  "day_plan.updated",
  "people.updated",
  "coordination.updated",
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
  "campus_event.updated",
  "fees.updated",
] as const;

export type SchoolEventType = (typeof SCHOOL_EVENT_TYPES)[number];

export const REFRESH_TARGETS = [
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
  "notifications",
  "campus-events",
  "fees",
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

const defaultsByType: Record<SchoolEventType, readonly RefreshTarget[]> = {
  "day_plan.updated": ["day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "notifications"],
  "people.updated": ["people", "teacher.home", "teacher.attendance", "principal.home", "principal.attendance", "parent.home"],
  "coordination.updated": ["coordination"],
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
  "leave.updated": ["student.home", "student.leave", "parent.home", "parent.leave", "teacher.home", "principal.home", "notifications"],
  "timetable.updated": ["day-plans", "student.home", "student.timetable", "parent.home", "parent.timetable", "teacher.home", "principal.home", "principal.timetable"],
  "fees.updated": ["fees"],
  "campus_event.updated": ["campus-events", "notifications"],
};

export const FULL_SYNC_INVALIDATIONS: readonly QueryInvalidation[] = [
  { queryKey: ["teacher-home"] },
  { queryKey: ["principal-home"] },
  { queryKey: ["register"] },
  { queryKey: ["register-history"] },
  { queryKey: ["principal-timetable"] },
  { queryKey: ["leaves"] },
  { queryKey: ["notifications"] },
  { queryKey: ["family-timetable"] },
  { queryKey: ["family-diary"] },
  { queryKey: ["parent-home"] },
  { queryKey: ["student-home"] },
  { queryKey: ["parent-leaves"] },
  { queryKey: ["student-leave"] },
  { queryKey: ["parent-attendance"] },
  { queryKey: ["subject-attendance"] },
  { queryKey: ["student-attendance"] },
  { queryKey: ["campus-events"] },
  { queryKey: ["campus-event"] },
  { queryKey: ["campus-event-register"] },
  { queryKey: ["campus-event-finance"] },
  { queryKey: ["fees"] },
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
  return payload ? { id: value.id, type: value.type, created_at: value.created_at, payload } : null;
}

function studentInvalidations(area: "home" | "attendance" | "eligibility" | "diary" | "leave" | "timetable"): QueryInvalidation[] {
  switch (area) {
    case "home": return [{ queryKey: ["student-home"] }];
    case "attendance":
    case "eligibility": return [{ queryKey: ["student-attendance"] }, { queryKey: ["subject-attendance"] }];
    case "diary": return [{ queryKey: ["family-diary", "student"] }];
    case "leave": return [{ queryKey: ["student-leave"] }];
    case "timetable": return [{ queryKey: ["family-timetable", "student"] }];
  }
}

function familyInvalidations(
  root: "parent-home" | "parent-attendance" | "subject-attendance" | "parent-leaves",
  studentId?: string,
): QueryInvalidation[] {
  return studentId
    ? [{ queryKey: [root, studentId] }, { queryKey: [root, null], exact: true }]
    : [{ queryKey: [root] }];
}

function parentAreaInvalidations(
  area: "home" | "attendance" | "diary" | "leave" | "timetable",
  studentId?: string,
): QueryInvalidation[] {
  switch (area) {
    case "home": return familyInvalidations("parent-home", studentId);
    case "attendance": return [
      ...familyInvalidations("parent-attendance", studentId),
      ...familyInvalidations("subject-attendance", studentId),
    ];
    case "diary": return studentId
      ? [{ queryKey: ["family-diary", "parent", studentId] }, { queryKey: ["family-diary", "parent", null] }]
      : [{ queryKey: ["family-diary", "parent"] }];
    case "leave": return familyInvalidations("parent-leaves", studentId);
    case "timetable": return studentId
      ? [{ queryKey: ["family-timetable", "parent", studentId] }, { queryKey: ["family-timetable", "parent", null], exact: true }]
      : [{ queryKey: ["family-timetable", "parent"] }];
  }
}

function dated(root: "teacher-home" | "principal-home", payload: SchoolEventPayload): QueryInvalidation {
  return { queryKey: payload.date ? [root, payload.date] : [root] };
}

function registerInvalidation(payload: SchoolEventPayload): QueryInvalidation {
  return {
    queryKey: payload.class_section_id
      ? payload.date
        ? ["register", payload.class_section_id, payload.date]
        : ["register", payload.class_section_id]
      : ["register"],
  };
}

function invalidationsForTarget(target: RefreshTarget, payload: SchoolEventPayload): QueryInvalidation[] {
  switch (target) {
    case "day-plans": return [{ queryKey: ["school", "day-plans"] }];
    case "people": return [{ queryKey: ["school", "people"] }, { queryKey: ["school", "parent"] }];
    case "coordination": return [{ queryKey: ["school", "coordination"] }];
    case "student.home": return studentInvalidations("home");
    case "student.attendance": return studentInvalidations("attendance");
    case "student.eligibility": return studentInvalidations("eligibility");
    case "student.diary": return studentInvalidations("diary");
    case "student.leave": return studentInvalidations("leave");
    case "student.timetable": return studentInvalidations("timetable");
    case "parent.home": return parentAreaInvalidations("home", payload.student_id);
    case "parent.attendance": return parentAreaInvalidations("attendance", payload.student_id);
    case "parent.diary": return parentAreaInvalidations("diary", payload.student_id);
    case "parent.leave": return parentAreaInvalidations("leave", payload.student_id);
    case "parent.timetable": return parentAreaInvalidations("timetable", payload.student_id);
    case "teacher.home": return [dated("teacher-home", payload)];
    case "teacher.attendance": return [registerInvalidation(payload)];
    case "principal.home": return [dated("principal-home", payload)];
    case "principal.attendance": return [registerInvalidation(payload)];
    case "principal.attendance-history": return [{ queryKey: ["register-history"] }];
    case "principal.timetable": return [{ queryKey: ["principal-timetable"] }];
    case "notifications": return [{ queryKey: ["notifications"] }];
    case "fees": return [{ queryKey: ["fees"] }, { queryKey: ["campus-event-finance"] }];
    case "campus-events": return [
      { queryKey: ["campus-events"] },
      { queryKey: ["campus-event"] },
      { queryKey: ["campus-event-register"] },
      { queryKey: ["campus-event-finance"] },
      { queryKey: ["fees"] },
    ];
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

export function resolveSchoolEvent(data: string, expectedType: SchoolEventType): EventResolution {
  const envelope = decodeSchoolEvent(data, expectedType);
  if (!envelope) return { envelope: null, invalidations: [...FULL_SYNC_INVALIDATIONS], usedFallback: true };

  const targets = envelope.payload.refresh ?? defaultsByType[expectedType];
  const invalidations = targets.flatMap((target) => invalidationsForTarget(target, envelope.payload));
  // Staff leave queues have their own cache key, while the cross-client event
  // vocabulary intentionally exposes role-neutral home/leave refresh targets.
  if (expectedType === "leave.updated") invalidations.push({ queryKey: ["leaves"] });
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
