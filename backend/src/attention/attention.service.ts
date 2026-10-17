import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ChatService } from "../chat/chat.service.js";
import type { AuthUser } from "../common/request.js";
import { NoticesService } from "../notices/notices.service.js";
import { RequestsService } from "../requests/requests.service.js";
import type { RequestCategory, RequestInboxItem, RequestPortal, RequestPriority } from "../requests/requests.types.js";
import { NotificationAttentionService } from "./notification-attention.service.js";
import type {
  AttentionItem,
  AttentionModuleId,
  AttentionModuleRollup,
  AttentionResponse,
  AttentionRollup,
  AttentionState,
  ChatAttentionConversation,
  NoticeAttentionItem,
  NoticeAttentionProjection,
} from "./attention.types.js";

const querySchema = z.object({
  portal: z.enum(["parent", "teacher", "principal"]),
  student_id: z.string().uuid().optional(),
}).strict().refine((query) => query.portal === "parent" || query.student_id === undefined, {
  message: "student_id is only valid in parent attention context.",
  path: ["student_id"],
});

const priorityOrder: Record<RequestPriority, number> = { urgent: 0, high: 1, normal: 2 };
const stateOrder: Record<AttentionState, number> = { exception: 0, action_required: 1, new: 2 };
const states: readonly AttentionState[] = ["exception", "action_required", "new"];

const moduleByKind: Readonly<Record<string, AttentionModuleId>> = {
  event_rsvp: "events",
  event_consent: "events",
  event_payment: "events",
  event_checklist: "events",
  event_duty: "events",
  event_session_register: "events",
  event_refund_reconciliation: "events",
  leave_signature: "leave",
  diary_acknowledgement: "diary",
  attendance_followup: "attendance",
  notice_response: "notices",
  notice_exception: "notices",
  policy_acknowledgement: "policies",
  fee_due: "fees",
  responsibility_offer: "responsibilities",
  coverage_offer: "responsibilities",
  transport_assignment: "transport",
  transport_swap: "transport",
  assessment_invigilation: "assessments",
  assessment_work: "assessments",
  staff_leave_review: "staff",
  departure_change: "departure",
  transport_swap_approval: "departure",
  fee_review: "fees",
  policy_review: "governance",
  assessment_moderation: "assessments",
  assessment_publish: "assessments",
  attendance_reconciliation: "attendance",
  attendance_scope_mismatch: "attendance",
  attendance_decline_review: "attendance",
  student_concern: "safeguarding",
  student_leave_review: "leave",
  restricted_care_case: "safeguarding",
  report_card_review: "report-cards",
  teacher_feedback: "teacher-feedback",
  coverage_gap: "staff",
  journey_reconciliation: "departure",
  people_import_review: "people",
  policy_lifecycle: "governance",
  day_plan_draft: "weekly",
  schedule_draft: "weekly",
  teaching_assignment_gap: "weekly",
  responsibility_reassignment: "staff",
  payment_capture_review: "fees",
  collector_duty_gap: "departure",
  departure_plan_exception: "departure",
};

const exceptionKinds = new Set([
  "notice_exception",
  "attendance_reconciliation",
  "student_concern",
  "event_refund_reconciliation",
  "journey_reconciliation",
  "attendance_scope_mismatch",
  "responsibility_reassignment",
  "payment_capture_review",
  "collector_duty_gap",
  "departure_plan_exception",
]);
const conditionalExceptionKinds = new Set([
  "attendance_followup",
  "restricted_care_case",
  "coverage_gap",
  "event_session_register",
  "people_import_review",
  "policy_lifecycle",
  "day_plan_draft",
  "schedule_draft",
  "teaching_assignment_gap",
]);

function requestIsException(item: Pick<RequestInboxItem, "kind" | "priority" | "status_label">): boolean {
  if (exceptionKinds.has(item.kind)) return true;
  if (!conditionalExceptionKinds.has(item.kind)) return false;
  return item.priority === "urgent"
    || /overdue|declined|immediate action|incomplete|expires soon|rejected|start is due|needed today|unassigned today/i.test(item.status_label);
}

function fallbackModule(portal: RequestPortal, category: RequestCategory): Exclude<AttentionModuleId, "requests"> {
  switch (category) {
    case "attendance": return portal === "teacher" ? "registers" : "attendance";
    case "academics": return portal === "parent" ? "results" : "assessments";
    case "events": return "events";
    case "leave": return portal === "principal" ? "staff" : "leave";
    case "staffing": return portal === "principal" ? "staff" : "responsibilities";
    case "transport": return portal === "principal" || portal === "parent" ? "departure" : "transport";
    case "finance": return "fees";
    case "governance": return portal === "principal" ? "governance" : "policies";
    case "communication": return "messages";
    case "care": return "safeguarding";
  }
}

export function moduleForRequest(portal: RequestPortal, item: Pick<RequestInboxItem, "kind" | "category">): Exclude<AttentionModuleId, "requests"> {
  if (item.kind === "attendance_register") return portal === "teacher" ? "registers" : "attendance";
  if (item.kind === "policy_acknowledgement") return portal === "principal" ? "governance" : "policies";
  if (item.kind === "assessment_work" && portal === "parent") return "results";
  const mapped = moduleByKind[item.kind];
  return mapped && mapped !== "requests" ? mapped : fallbackModule(portal, item.category);
}

function sourceKind(kind: string) {
  return kind === "notice_response" || kind === "notice_exception" ? "notice" : kind;
}

export function mapRequestAttention(portal: RequestPortal, item: RequestInboxItem): AttentionItem {
  const source_kind = sourceKind(item.kind);
  const state = requestIsException(item) ? "exception" : "action_required";
  return {
    id: `attention:${source_kind}:${item.source_id}`,
    source_kind,
    source_id: item.source_id,
    module: moduleForRequest(portal, item),
    state,
    signals: [state],
    priority: item.priority,
    title: item.title,
    status_label: item.status_label,
    subject_label: item.subject_label,
    due_at: item.due_at,
    created_at: item.created_at ?? item.occurs_at,
    href: item.href,
  };
}

function normalizeSignals(item: AttentionItem): AttentionItem {
  const unique = new Set(item.signals?.length ? item.signals : [item.state]);
  const signals = states.filter((state) => unique.has(state));
  return { ...item, signals, state: signals[0] ?? item.state };
}

function signalsForNotice(item: NoticeAttentionItem): AttentionState[] {
  const reasons = new Set(item.attention_reasons ?? []);
  const signals = new Set<AttentionState>();
  if (reasons.has("unread")) signals.add("new");
  if (reasons.has("response_required") || reasons.has("response_overdue")) signals.add("action_required");
  if (reasons.has("delivery_failed") || reasons.has("response_overdue")) signals.add("exception");
  if (!signals.size) signals.add(item.state);
  return states.filter((state) => signals.has(state));
}

export function mapNoticeAttention(item: NoticeAttentionItem): AttentionItem {
  return normalizeSignals({
    id: item.id,
    source_kind: item.source_kind,
    source_id: item.source_id,
    module: "notices",
    state: item.state,
    signals: signalsForNotice(item),
    priority: item.priority,
    title: item.title,
    status_label: item.status_label,
    subject_label: item.subject_label,
    due_at: item.due_at,
    created_at: item.created_at,
    href: item.href,
  });
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapChatAttention(portal: RequestPortal, conversation: ChatAttentionConversation): AttentionItem | null {
  const unread = Number(conversation.unread_count ?? 0);
  if (!Number.isFinite(unread) || unread <= 0) return null;
  const href = `/${portal}/messages?conversation=${encodeURIComponent(conversation.id)}`;
  return {
    id: `chat:${conversation.id}`,
    source_kind: "chat_conversation",
    source_id: conversation.id,
    module: "messages",
    state: "new",
    signals: ["new"],
    priority: "normal",
    title: conversation.title || "Conversation",
    status_label: `${unread} unread ${unread === 1 ? "message" : "messages"}`,
    subject_label: conversation.student_name ?? null,
    due_at: null,
    created_at: iso(conversation.last_message_at ?? conversation.created_at),
    href: portal === "parent" && conversation.context_student_id
      ? `${href}&student_id=${encodeURIComponent(conversation.context_student_id)}`
      : href,
  };
}

function earlier(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}

function mergeAttentionItem(current: AttentionItem, incoming: AttentionItem): AttentionItem {
  const currentNormalized = normalizeSignals(current);
  const incomingNormalized = normalizeSignals(incoming);
  const mergedSignals = states.filter((state) => currentNormalized.signals.includes(state) || incomingNormalized.signals.includes(state));
  const strongestState = mergedSignals[0] ?? currentNormalized.state;
  const incomingStateWins = stateOrder[incomingNormalized.state] < stateOrder[currentNormalized.state];
  const incomingPriorityWins = priorityOrder[incoming.priority] < priorityOrder[current.priority];
  const noticeIdentity = incoming.source_kind === "notice" && incoming.id.startsWith("notice:") ? incoming.id : current.id;
  const typedNotification = incoming.id.startsWith("notification:") ? incoming
    : current.id.startsWith("notification:") ? current : null;
  return {
    ...currentNormalized,
    id: typedNotification?.id ?? noticeIdentity,
    source_kind: typedNotification?.source_kind ?? currentNormalized.source_kind,
    source_id: typedNotification?.source_id ?? currentNormalized.source_id,
    module: incoming.module === "notices" ? "notices" : current.module,
    state: strongestState,
    signals: mergedSignals,
    priority: incomingPriorityWins ? incoming.priority : current.priority,
    title: incomingStateWins ? incoming.title : current.title,
    status_label: incomingStateWins ? incoming.status_label : current.status_label,
    subject_label: current.subject_label ?? incoming.subject_label,
    due_at: earlier(current.due_at, incoming.due_at),
    created_at: earlier(current.created_at, incoming.created_at),
    // Requests already point at the authoritative workflow. Preserve that exact
    // destination when the notice projection describes the same obligation.
    href: typedNotification?.href ?? (incoming.id.startsWith("attention:") && (current.id.startsWith("notice:") || incomingStateWins)
      ? incoming.href
      : current.href),
  };
}

function correlatedOutcomeKey(item: AttentionItem): string | null {
  if (["policy_publication", "policy_acknowledgement"].includes(item.source_kind)) {
    return `policy:${item.source_id}`;
  }
  if (["restricted_care_update", "restricted_care_case"].includes(item.source_kind)) {
    return `restricted-care:${item.source_id}`;
  }
  // A declined staff response produces two truthful views of one workflow:
  // the responder's unread outcome and the principal's still-open exception.
  // Keep both signals, but never make the same assignment look like two jobs.
  if (["responsibility_response", "responsibility_reassignment"].includes(item.source_kind)) {
    return `responsibility:${item.source_id}`;
  }
  if (["coverage_response", "coverage_gap"].includes(item.source_kind)) {
    return `coverage:${item.source_id}`;
  }
  return null;
}

export function composeAttentionItems(requestItems: readonly AttentionItem[], noticeItems: readonly AttentionItem[]): AttentionItem[] {
  // Notice recipient identity is meaningful: the same published notice may
  // create one independently clearable item per child/recipient. Start with
  // those stable IDs, then merge the generic Requests obligation only when it
  // has one unambiguous recipient projection in the authorized scope.
  const unique = new Map<string, AttentionItem>();
  for (const rawNotice of noticeItems) {
    const item = normalizeSignals(rawNotice);
    const key = `id:${item.id}`;
    const current = unique.get(key);
    unique.set(key, current ? mergeAttentionItem(current, item) : item);
  }

  for (const rawRequest of requestItems) {
    const item = normalizeSignals(rawRequest);
    if (item.source_kind === "notice") {
      const candidates = [...unique.entries()].filter(([, candidate]) => (
        candidate.source_kind === "notice" && candidate.source_id === item.source_id
      ));
      const exactHref = candidates.filter(([, candidate]) => candidate.href === item.href);
      const sameSubject = candidates.filter(([, candidate]) => (
        Boolean(item.subject_label) && candidate.subject_label === item.subject_label
      ));
      const match = exactHref.length === 1 ? exactHref[0]
        : sameSubject.length === 1 ? sameSubject[0]
          : candidates.length === 1 ? candidates[0]
            : undefined;
      if (match) {
        unique.set(match[0], mergeAttentionItem(match[1], item));
        continue;
      }
    }
    const key = correlatedOutcomeKey(item) ?? `source:${item.source_kind}:${item.source_id}`;
    const current = unique.get(key);
    unique.set(key, current ? mergeAttentionItem(current, item) : item);
  }
  return [...unique.values()].sort((left, right) => {
    const state = stateOrder[left.state] - stateOrder[right.state];
    if (state) return state;
    const priority = priorityOrder[left.priority] - priorityOrder[right.priority];
    if (priority) return priority;
    const leftTime = Date.parse(left.due_at ?? left.created_at ?? "9999-12-31T00:00:00.000Z");
    const rightTime = Date.parse(right.due_at ?? right.created_at ?? "9999-12-31T00:00:00.000Z");
    return leftTime - rightTime || left.id.localeCompare(right.id);
  });
}

function emptyRollup(): AttentionRollup {
  return { total: 0, new: 0, action_required: 0, exceptions: 0, urgent: 0, high: 0, normal: 0, highest_priority: null };
}

function addToRollup(rollup: AttentionRollup, item: AttentionItem) {
  rollup.total += 1;
  if (item.signals.includes("new")) rollup.new += 1;
  if (item.signals.includes("action_required")) rollup.action_required += 1;
  if (item.signals.includes("exception")) rollup.exceptions += 1;
  rollup[item.priority] += 1;
  if (rollup.highest_priority === null || priorityOrder[item.priority] < priorityOrder[rollup.highest_priority]) {
    rollup.highest_priority = item.priority;
  }
}

function parentScoped(path: string, portal: RequestPortal, studentId: string | null | undefined) {
  if (portal !== "parent" || !studentId || !path.startsWith("/parent/")) return path;
  return `${path}${path.includes("?") ? "&" : "?"}student_id=${encodeURIComponent(studentId)}`;
}

export function moduleHref(portal: RequestPortal, module: AttentionModuleId, studentId?: string | null): string {
  const portalPaths: Record<RequestPortal, Partial<Record<AttentionModuleId, string>>> = {
    parent: {
      requests: "/parent/requests", attendance: "/parent/attendance", leave: "/parent/leave",
      diary: "/parent/diary", events: "/parent/events", notices: "/parent/notices",
      policies: "/parent/policies", fees: "/parent/fees", results: "/parent/results",
      calendar: "/parent/calendar", timetable: "/parent/timetable",
      "teacher-feedback": "/parent/teacher-feedback",
      departure: "/parent/departure", messages: "/parent/messages",
    },
    teacher: {
      requests: "/teacher/requests", attendance: "/teacher/attendance", registers: "/teacher/attendance",
      leave: "/teacher/leave", events: "/teacher/events",
      notices: "/teacher/notices", policies: "/teacher/policies", fees: "/teacher/fees",
      assessments: "/teacher/assessments", transport: "/teacher/transport",
      "report-cards": "/teacher/report-cards",
      safeguarding: "/teacher/safeguarding", responsibilities: "/teacher/responsibilities",
      people: "/teacher/students", messages: "/teacher/messages",
      calendar: "/teacher/calendar", timetable: "/teacher/timetable",
      weekly: "/teacher/timetable/weekly",
    },
    principal: {
      requests: "/principal/requests", attendance: "/principal/attendance", events: "/principal/events",
      notices: "/principal/notices", governance: "/principal/governance", fees: "/principal/fees",
      assessments: "/principal/assessments", departure: "/principal/departure",
      leave: "/principal/student-leave", "report-cards": "/principal/report-cards",
      "teacher-feedback": "/principal/teacher-feedback",
      safeguarding: "/principal/safeguarding", staff: "/principal/staff",
      people: "/principal/students", messages: "/principal/messages",
      calendar: "/principal/calendar", timetable: "/principal/timetable",
      weekly: "/principal/timetable",
    },
  };
  const path = portalPaths[portal][module] ?? `/${portal}/more`;
  return parentScoped(path, portal, studentId);
}

export function summarizeAttention(
  portal: RequestPortal,
  items: readonly AttentionItem[],
  studentId?: string | null,
): Pick<AttentionResponse, "summary" | "modules"> {
  const overall = emptyRollup();
  const modules: Partial<Record<AttentionModuleId, AttentionModuleRollup>> = {};
  for (const item of items) {
    addToRollup(overall, item);
    const moduleRollup = modules[item.module] ?? {
      ...emptyRollup(), href: moduleHref(portal, item.module, studentId), first_item_href: null,
    };
    addToRollup(moduleRollup, item);
    moduleRollup.first_item_href ??= item.href;
    modules[item.module] = moduleRollup;
    const requestSignals = item.signals.filter((signal) => signal !== "new");
    if (requestSignals.length) {
      const requests = modules.requests ?? {
        ...emptyRollup(), href: moduleHref(portal, "requests", studentId), first_item_href: null,
      };
      addToRollup(requests, { ...item, signals: requestSignals });
      requests.first_item_href ??= item.href;
      modules.requests = requests;
    }
  }
  return { summary: overall, modules };
}

@Injectable()
export class AttentionService {
  constructor(
    private readonly requests: RequestsService,
    private readonly notices: NoticesService,
    private readonly chat: ChatService,
    private readonly notificationAttention: NotificationAttentionService,
  ) {}

  async inbox(user: AuthUser, rawQuery: Record<string, string | undefined>): Promise<AttentionResponse> {
    const parsed = querySchema.safeParse(rawQuery);
    if (!parsed.success) throw new BadRequestException("Choose parent, teacher or principal attention context.");
    const requestQuery = {
      portal: parsed.data.portal,
      ...(parsed.data.student_id ? { student_id: parsed.data.student_id } : {}),
    };
    const requestProjection = await this.requests.inbox(user, requestQuery);
    const canReadCommunication = parsed.data.portal !== "teacher"
      || await this.requests.canReadCommunication(user, requestProjection.scope.school_id);
    const noticeQuery = {
      portal: parsed.data.portal,
      ...(requestProjection.scope.student_id ? { student_id: requestProjection.scope.student_id } : {}),
    };
    const [noticeProjection, conversationProjection, notificationItems] = await Promise.all([
      canReadCommunication
        ? this.notices.attentionItems(user, noticeQuery) as Promise<NoticeAttentionProjection>
        : Promise.resolve({ summary: { total: 0, unread: 0, action_required: 0, exceptions: 0 }, items: [] }),
      canReadCommunication
        ? this.chat.attentionConversations(user)
        : Promise.resolve({ results: [] }),
      this.notificationAttention.unread(user, {
        portal: parsed.data.portal,
        schoolId: requestProjection.scope.school_id,
        studentId: requestProjection.scope.student_id,
      }),
    ]);
    const requestItems = requestProjection.items
      .filter((item) => canReadCommunication || !["notice_response", "notice_exception"].includes(item.kind))
      .map((item) => mapRequestAttention(parsed.data.portal, item));
    const noticeItems = noticeProjection.items.map(mapNoticeAttention);
    const visibleConversations = (conversationProjection.results as ChatAttentionConversation[]).filter((conversation) => (
      conversation.school_id === requestProjection.scope.school_id
      && (parsed.data.portal !== "parent"
        || conversation.context_student_id === null
        || conversation.context_student_id === requestProjection.scope.student_id)
    ));
    const chatItems = visibleConversations
      .map((conversation) => mapChatAttention(parsed.data.portal, conversation))
      .filter((item): item is AttentionItem => item !== null);
    const items = composeAttentionItems([...requestItems, ...chatItems, ...notificationItems], noticeItems);
    const rollups = summarizeAttention(parsed.data.portal, items, requestProjection.scope.student_id);
    return {
      portal: parsed.data.portal,
      generated_at: new Date().toISOString(),
      scope: requestProjection.scope,
      ...rollups,
      items,
    };
  }
}
