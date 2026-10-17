import { describe, expect, it, vi } from "vitest";
import type { ChatService } from "../src/chat/chat.service.js";
import type { AuthUser } from "../src/common/request.js";
import type { NoticesService } from "../src/notices/notices.service.js";
import type { RequestsService } from "../src/requests/requests.service.js";
import type { RequestCategory, RequestInboxItem, RequestPortal } from "../src/requests/requests.types.js";
import {
  AttentionService,
  composeAttentionItems,
  mapChatAttention,
  mapNoticeAttention,
  mapRequestAttention,
  moduleHref,
  moduleForRequest,
  summarizeAttention,
} from "../src/attention/attention.service.js";
import type { AttentionItem, NoticeAttentionItem } from "../src/attention/attention.types.js";
import type { NotificationAttentionService } from "../src/attention/notification-attention.service.js";

function emptyNotificationAttention() {
  return { unread: vi.fn().mockResolvedValue([]) } as unknown as NotificationAttentionService;
}

function requestItem(kind: string, category: RequestCategory, sourceId = `${kind}-id`): RequestInboxItem {
  return {
    id: `${kind}:${sourceId}`,
    kind,
    category,
    priority: "high",
    title: `${kind} title`,
    detail: `${kind} detail`,
    status_label: `${kind} status`,
    action_label: "Open",
    href: `/canonical/${kind}?source=${sourceId}`,
    source_id: sourceId,
    subject_label: "Aarav Sharma",
    occurs_at: "2026-10-12T10:00:00.000Z",
    due_at: "2026-10-14T10:00:00.000Z",
    created_at: "2026-10-12T09:00:00.000Z",
  };
}

const mappingCases: Array<[RequestPortal, string, RequestCategory, AttentionItem["module"]]> = [
  ["parent", "event_rsvp", "events", "events"],
  ["parent", "event_consent", "events", "events"],
  ["parent", "event_payment", "events", "events"],
  ["parent", "event_checklist", "events", "events"],
  ["teacher", "event_duty", "events", "events"],
  ["parent", "leave_signature", "leave", "leave"],
  ["parent", "diary_acknowledgement", "communication", "diary"],
  ["teacher", "attendance_register", "attendance", "registers"],
  ["principal", "attendance_register", "attendance", "attendance"],
  ["parent", "attendance_followup", "attendance", "attendance"],
  ["parent", "notice_response", "communication", "notices"],
  ["principal", "notice_exception", "communication", "notices"],
  ["parent", "policy_acknowledgement", "governance", "policies"],
  ["principal", "policy_acknowledgement", "governance", "governance"],
  ["parent", "fee_due", "finance", "fees"],
  ["teacher", "responsibility_offer", "staffing", "responsibilities"],
  ["teacher", "coverage_offer", "staffing", "responsibilities"],
  ["teacher", "transport_assignment", "transport", "transport"],
  ["teacher", "transport_swap", "transport", "transport"],
  ["teacher", "assessment_invigilation", "academics", "assessments"],
  ["teacher", "assessment_work", "academics", "assessments"],
  ["principal", "staff_leave_review", "leave", "staff"],
  ["principal", "departure_change", "transport", "departure"],
  ["principal", "transport_swap_approval", "transport", "departure"],
  ["principal", "fee_review", "finance", "fees"],
  ["principal", "policy_review", "governance", "governance"],
  ["principal", "assessment_moderation", "academics", "assessments"],
  ["principal", "assessment_publish", "academics", "assessments"],
  ["principal", "attendance_reconciliation", "attendance", "attendance"],
  ["principal", "attendance_scope_mismatch", "attendance", "attendance"],
  ["principal", "attendance_decline_review", "attendance", "attendance"],
  ["principal", "student_concern", "care", "safeguarding"],
  ["principal", "student_leave_review", "leave", "leave"],
  ["teacher", "restricted_care_case", "care", "safeguarding"],
  ["teacher", "report_card_review", "academics", "report-cards"],
  ["principal", "report_card_review", "academics", "report-cards"],
  ["parent", "teacher_feedback", "academics", "teacher-feedback"],
  ["principal", "coverage_gap", "staffing", "staff"],
  ["teacher", "event_session_register", "events", "events"],
  ["principal", "event_refund_reconciliation", "finance", "events"],
  ["principal", "journey_reconciliation", "transport", "departure"],
  ["teacher", "people_import_review", "academics", "people"],
  ["principal", "policy_lifecycle", "governance", "governance"],
  ["principal", "day_plan_draft", "academics", "weekly"],
  ["principal", "schedule_draft", "academics", "weekly"],
  ["principal", "teaching_assignment_gap", "staffing", "weekly"],
  ["principal", "responsibility_reassignment", "staffing", "staff"],
  ["principal", "payment_capture_review", "finance", "fees"],
  ["principal", "collector_duty_gap", "transport", "departure"],
  ["principal", "departure_plan_exception", "transport", "departure"],
];

describe("attention request mapping", () => {
  it.each(mappingCases)("maps %s %s to its owning %s module", (portal, kind, category, module) => {
    expect(moduleForRequest(portal, requestItem(kind, category))).toBe(module);
  });

  it("preserves the authoritative request destination and exact source identity", () => {
    const input = requestItem("fee_review", "finance", "fee-review-42");
    const item = mapRequestAttention("principal", input);
    expect(item).toMatchObject({
      id: "attention:fee_review:fee-review-42",
      source_kind: "fee_review",
      source_id: "fee-review-42",
      module: "fees",
      state: "action_required",
      href: "/canonical/fee_review?source=fee-review-42",
    });
  });

  it.each(["notice_exception", "attendance_reconciliation", "student_concern", "event_refund_reconciliation", "journey_reconciliation",
    "attendance_scope_mismatch", "responsibility_reassignment", "payment_capture_review", "collector_duty_gap", "departure_plan_exception"])(
    "classifies %s as an exception rather than ordinary new information",
    (kind) => {
      const category: RequestCategory = kind === "student_concern" ? "care"
        : kind.startsWith("notice") ? "communication"
          : kind.startsWith("event_refund") ? "finance"
            : kind.startsWith("payment") ? "finance"
              : kind.startsWith("journey") || kind.startsWith("collector") || kind.startsWith("departure") ? "transport"
                : kind.startsWith("responsibility") ? "staffing" : "attendance";
      expect(mapRequestAttention("principal", requestItem(kind, category)).state).toBe("exception");
    },
  );

  it.each([
    ["attendance_followup", "attendance", "Overdue"],
    ["restricted_care_case", "care", "Immediate action required"],
    ["coverage_gap", "staffing", "Cover declined"],
    ["event_session_register", "events", "Attendance incomplete"],
    ["people_import_review", "academics", "Expires soon"],
    ["policy_lifecycle", "governance", "Revision rejected"],
    ["day_plan_draft", "academics", "Needed today"],
    ["schedule_draft", "academics", "Schedule start is due"],
    ["teaching_assignment_gap", "staffing", "Teacher unassigned today"],
  ] as Array<[string, RequestCategory, string]>) (
    "classifies urgent or failed %s work as an exception without making its ordinary state alarming",
    (kind, category, statusLabel) => {
      const ordinary = requestItem(kind, category);
      ordinary.priority = "high";
      ordinary.status_label = "Review needed";
      expect(mapRequestAttention("principal", ordinary).state).toBe("action_required");
      expect(mapRequestAttention("principal", { ...ordinary, status_label: statusLabel }).state).toBe("exception");
    },
  );
});

describe("attention composition", () => {
  it.each([
    ["policy_acknowledgement", "policy_publication", "governance", "policies", "policy-1"],
    ["restricted_care_case", "restricted_care_update", "care", "safeguarding", "case-1"],
  ] as Array<[string, string, RequestCategory, AttentionItem["module"], string]>)(
    "merges %s work with its %s update while preserving the clear-on-open destination",
    (requestKind, notificationKind, category, module, sourceId) => {
      const request = mapRequestAttention("teacher", requestItem(requestKind, category, sourceId));
      const notification: AttentionItem = {
        id: `notification:${sourceId}`,
        source_kind: notificationKind,
        source_id: sourceId,
        module,
        state: "new",
        signals: ["new"],
        priority: "normal",
        title: "New update",
        status_label: "New",
        subject_label: null,
        due_at: null,
        created_at: "2026-10-13T10:00:00.000Z",
        href: `/teacher/${module}?source=${sourceId}&attention_notification_id=${sourceId}`,
      };

      const together = composeAttentionItems([request, notification], []);
      expect(together).toHaveLength(1);
      expect(together[0]).toMatchObject({
        id: `notification:${sourceId}`,
        source_kind: notificationKind,
        signals: ["action_required", "new"],
        href: notification.href,
      });
      expect(composeAttentionItems([request], [])[0]?.signals).toEqual(["action_required"]);
    },
  );

  it.each([
    ["responsibility_reassignment", "responsibility_response"],
    ["coverage_gap", "coverage_response"],
  ] as const)("merges a %s exception with its unread %s outcome", (requestKind, notificationKind) => {
    const sourceId = `${requestKind}-1`;
    const request = mapRequestAttention("principal", {
      ...requestItem(requestKind, "staffing", sourceId),
      priority: "urgent",
      status_label: requestKind === "coverage_gap" ? "Cover declined" : "Assignment declined",
    });
    const notification: AttentionItem = {
      id: `notification:${notificationKind}-1`,
      source_kind: notificationKind,
      source_id: sourceId,
      module: "staff",
      state: "new",
      signals: ["new"],
      priority: "normal",
      title: "Staff response received",
      status_label: "New response",
      subject_label: "Meera Kapoor",
      due_at: null,
      created_at: "2026-10-13T10:00:00.000Z",
      href: `/principal/staff?source=${sourceId}&attention_notification_id=${notificationKind}-1`,
    };

    const items = composeAttentionItems([request, notification], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: `notification:${notificationKind}-1`,
      source_kind: notificationKind,
      source_id: sourceId,
      state: "exception",
      signals: ["exception", "new"],
      href: notification.href,
    });
  });

  it("keeps an accepted staff response as standalone new information when no exception remains", () => {
    const response: AttentionItem = {
      id: "notification:response-accepted",
      source_kind: "responsibility_response",
      source_id: "assignment-accepted",
      module: "staff",
      state: "new",
      signals: ["new"],
      priority: "normal",
      title: "Assignment accepted",
      status_label: "New response",
      subject_label: "Meera Kapoor",
      due_at: null,
      created_at: "2026-10-13T10:00:00.000Z",
      href: "/principal/staff?assignment=assignment-accepted&attention_notification_id=response-accepted",
    };
    expect(composeAttentionItems([response], [])).toEqual([response]);
  });

  it("deduplicates the Requests and Notices views of one obligation", () => {
    const request = mapRequestAttention("parent", requestItem("notice_response", "communication", "notice-1"));
    const notice: AttentionItem = {
      id: "notice:notice-1:recipient-1",
      source_kind: "notice",
      source_id: "notice-1",
      module: "notices",
      state: "new",
      signals: ["new"],
      priority: "normal",
      title: "Trip timing",
      status_label: "Unread",
      subject_label: "Aarav Sharma",
      due_at: request.due_at,
      created_at: request.created_at,
      href: "/parent/notices/notice-1?student_id=student-1",
    };
    const result = composeAttentionItems([request], [notice]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "notice:notice-1:recipient-1",
      state: "action_required",
      signals: ["action_required", "new"],
      priority: "high",
      href: request.href,
    });
  });

  it("keeps recipient-level notice attention distinct while merging the matching child request", () => {
    const request = mapRequestAttention("parent", requestItem("notice_response", "communication", "notice-1"));
    request.subject_label = "Aarav Sharma";
    const recipient = (id: string, subject: string): AttentionItem => ({
      id: `notice:notice-1:${id}`,
      source_kind: "notice",
      source_id: "notice-1",
      module: "notices",
      state: "new",
      signals: ["new"],
      priority: "normal",
      title: "Trip timing",
      status_label: "New notice",
      subject_label: subject,
      due_at: null,
      created_at: "2026-10-12T09:00:00.000Z",
      href: `/parent/notices/notice-1?student_id=${id}`,
    });
    const items = composeAttentionItems([request], [
      recipient("child-aarav", "Aarav Sharma"),
      recipient("child-ananya", "Ananya Sharma"),
    ]);
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.subject_label === "Aarav Sharma")?.signals)
      .toEqual(["action_required", "new"]);
    expect(items.find((item) => item.subject_label === "Ananya Sharma")?.signals).toEqual(["new"]);
  });

  it("preserves new and action-required independently as a required notice is opened", () => {
    const request = mapRequestAttention("parent", requestItem("notice_response", "communication", "notice-1"));
    const noticeProjection: NoticeAttentionItem = {
      id: "notice:notice-1:recipient-1", source_kind: "notice", source_id: "notice-1", module: "notices",
      state: "action_required", attention_reasons: ["unread", "response_required"], priority: "high",
      title: "Trip timing", status_label: "Response needed", subject_label: "Aarav Sharma",
      due_at: request.due_at, created_at: request.created_at, href: "/parent/notices/notice-1?student_id=student-1",
    };
    const unseen = mapNoticeAttention(noticeProjection);
    const beforeOpen = composeAttentionItems([request], [unseen]);
    expect(beforeOpen[0]?.signals).toEqual(["action_required", "new"]);
    expect(summarizeAttention("parent", beforeOpen, "student-1").modules.notices)
      .toMatchObject({ total: 1, new: 1, action_required: 1 });

    const opened = mapNoticeAttention({
      ...noticeProjection,
      attention_reasons: ["response_required"],
    });
    const afterOpen = composeAttentionItems([request], [opened]);
    expect(afterOpen[0]?.signals).toEqual(["action_required"]);
    expect(summarizeAttention("parent", afterOpen, "student-1").modules.notices)
      .toMatchObject({ total: 1, new: 0, action_required: 1 });
  });

  it("uses exception precedence without counting the same notice twice", () => {
    const response = mapRequestAttention("principal", requestItem("notice_response", "communication", "notice-2"));
    const exception = mapRequestAttention("principal", {
      ...requestItem("notice_exception", "communication", "notice-2"),
      priority: "urgent",
      status_label: "Delivery failed",
    });
    const items = composeAttentionItems([response, exception], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ state: "exception", priority: "urgent", status_label: "Delivery failed" });
  });

  it("builds unique overall, owning-module and cross-module Requests rollups", () => {
    const noticeAction = mapRequestAttention("parent", requestItem("notice_response", "communication", "notice-1"));
    const eventAction = mapRequestAttention("parent", requestItem("event_consent", "events", "event-1"));
    const noticeInfo: AttentionItem = {
      ...noticeAction,
      id: "notice:notice-3:recipient-3",
      source_id: "notice-3",
      state: "new",
      signals: ["new"],
      priority: "normal",
      status_label: "Unread",
      href: "/parent/notices/notice-3?student_id=student-1",
    };
    const items = composeAttentionItems([noticeAction, eventAction], [noticeInfo]);
    const projection = summarizeAttention("parent", items, "student-1");
    expect(projection.summary).toMatchObject({ total: 3, new: 1, action_required: 2, exceptions: 0, high: 2, normal: 1 });
    expect(projection.modules.notices).toMatchObject({
      total: 2, new: 1, action_required: 1,
      href: "/parent/notices?student_id=student-1",
      first_item_href: noticeAction.href,
    });
    expect(projection.modules.events).toMatchObject({ total: 1, action_required: 1 });
    expect(projection.modules.requests).toMatchObject({
      total: 2, new: 0, action_required: 2,
      href: "/parent/requests?student_id=student-1",
    });
  });

  it("maps unread conversations to Messages without adding them to Requests", () => {
    const chat = mapChatAttention("teacher", {
      id: "conversation-1", school_id: "school-1", title: "Grade 7 · A", student_name: null,
      unread_count: 2, last_message_at: "2026-10-13T08:00:00.000Z",
    });
    expect(chat).toMatchObject({
      id: "chat:conversation-1", module: "messages", state: "new",
      href: "/teacher/messages?conversation=conversation-1",
      status_label: "2 unread messages",
    });
    const projection = summarizeAttention("teacher", [chat!]);
    expect(projection.modules.messages).toMatchObject({ total: 1, new: 1, action_required: 0 });
    expect(projection.modules.requests).toBeUndefined();
  });

  it("keeps the authorized child scope in parent conversation deep links", () => {
    const chat = mapChatAttention("parent", {
      id: "conversation/1",
      school_id: "school-1",
      title: "Aarav support",
      context_student_id: "student/1",
      student_name: "Aarav Sharma",
      unread_count: 1,
    });

    expect(chat?.href).toBe(
      "/parent/messages?conversation=conversation%2F1&student_id=student%2F1",
    );
  });

  it("uses canonical module paths independently from the first exact item destination", () => {
    expect(moduleHref("principal", "safeguarding")).toBe("/principal/safeguarding");
    expect(moduleHref("principal", "leave")).toBe("/principal/student-leave");
    expect(moduleHref("teacher", "report-cards")).toBe("/teacher/report-cards");
    expect(moduleHref("principal", "weekly")).toBe("/principal/timetable");
    expect(moduleHref("teacher", "weekly")).toBe("/teacher/timetable/weekly");
    expect(moduleHref("parent", "teacher-feedback", "child-1")).toBe("/parent/teacher-feedback?student_id=child-1");
    expect(moduleHref("parent", "events", "child-1")).toBe("/parent/events?student_id=child-1");
    expect(moduleHref("parent", "safeguarding", "child-1")).toBe("/parent/more?student_id=child-1");
    expect(moduleHref("teacher", "diary")).toBe("/teacher/more");
  });
});

describe("AttentionService", () => {
  it("uses the Requests-authorized child scope for the notice projection", async () => {
    const requestInbox = vi.fn().mockResolvedValue({
      portal: "parent",
      generated_at: "2026-10-13T00:00:00.000Z",
      scope: { school_id: "11111111-1111-4111-8111-111111111111", school_name: "School", timezone: "Asia/Kolkata", student_id: "22222222-2222-4222-8222-222222222222", student_name: "Aarav Sharma" },
      summary: { total: 0, urgent: 0, high: 0, normal: 0, categories: {} },
      items: [],
    });
    const noticeAttention = vi.fn().mockResolvedValue({
      summary: { total: 0, unread: 0, action_required: 0, exceptions: 0 },
      items: [],
    });
    const attentionConversations = vi.fn().mockResolvedValue({ results: [
      { id: "chat-child", school_id: "11111111-1111-4111-8111-111111111111", title: "Aarav support", context_student_id: "22222222-2222-4222-8222-222222222222", unread_count: 1 },
      { id: "chat-sibling", school_id: "11111111-1111-4111-8111-111111111111", title: "Sibling support", context_student_id: "44444444-4444-4444-8444-444444444444", unread_count: 2 },
      { id: "chat-school", school_id: "11111111-1111-4111-8111-111111111111", title: "School office", context_student_id: null, unread_count: 1 },
      { id: "chat-other-school", school_id: "55555555-5555-4555-8555-555555555555", title: "Other school", context_student_id: null, unread_count: 3 },
    ] });
    const notificationUnread = vi.fn().mockResolvedValue([]);
    const service = new AttentionService(
      { inbox: requestInbox } as unknown as RequestsService,
      { attentionItems: noticeAttention } as unknown as NoticesService,
      { attentionConversations } as unknown as ChatService,
      { unread: notificationUnread } as unknown as NotificationAttentionService,
    );
    const user = { id: "33333333-3333-4333-8333-333333333333" } as AuthUser;
    const result = await service.inbox(user, { portal: "parent" });
    expect(requestInbox).toHaveBeenCalledWith(user, { portal: "parent" });
    expect(noticeAttention).toHaveBeenCalledWith(user, {
      portal: "parent",
      student_id: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.scope.student_id).toBe("22222222-2222-4222-8222-222222222222");
    expect(attentionConversations).toHaveBeenCalledWith(user);
    expect(notificationUnread).toHaveBeenCalledWith(user, {
      portal: "parent",
      schoolId: "11111111-1111-4111-8111-111111111111",
      studentId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.modules.messages).toMatchObject({ total: 2, new: 2 });
    expect(result.items.map((item) => item.source_id)).toEqual(expect.arrayContaining(["chat-child", "chat-school"]));
    expect(result.items.map((item) => item.source_id)).not.toContain("chat-sibling");
    expect(result.items.map((item) => item.source_id)).not.toContain("chat-other-school");
  });

  it("omits teacher notice and chat attention when communication access is not effective", async () => {
    const noticeAttention = vi.fn();
    const attentionConversations = vi.fn();
    const requests = {
      inbox: vi.fn().mockResolvedValue({
        portal: "teacher",
        generated_at: "2026-10-13T00:00:00.000Z",
        scope: { school_id: "11111111-1111-4111-8111-111111111111", school_name: "School", timezone: "Asia/Kolkata", student_id: null, student_name: null },
        summary: { total: 2, urgent: 0, high: 2, normal: 0, categories: { communication: 1, governance: 1 } },
        items: [
          requestItem("notice_response", "communication", "notice-1"),
          requestItem("policy_acknowledgement", "governance", "policy-1"),
        ],
      }),
      canReadCommunication: vi.fn().mockResolvedValue(false),
    };
    const service = new AttentionService(
      requests as unknown as RequestsService,
      { attentionItems: noticeAttention } as unknown as NoticesService,
      { attentionConversations } as unknown as ChatService,
      emptyNotificationAttention(),
    );

    const result = await service.inbox({ id: "33333333-3333-4333-8333-333333333333" } as AuthUser, { portal: "teacher" });

    expect(requests.canReadCommunication).toHaveBeenCalledWith(expect.anything(), "11111111-1111-4111-8111-111111111111");
    expect(noticeAttention).not.toHaveBeenCalled();
    expect(attentionConversations).not.toHaveBeenCalled();
    expect(result.modules.notices).toBeUndefined();
    expect(result.modules.messages).toBeUndefined();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source_id).toBe("policy-1");
  });

  it("keeps an older unread thread when the composed attention set exceeds the normal 100-thread inbox cap", async () => {
    const schoolId = "11111111-1111-4111-8111-111111111111";
    const conversations = Array.from({ length: 101 }, (_, index) => ({
      id: `conversation-${index}`,
      school_id: schoolId,
      title: `Conversation ${index}`,
      context_student_id: null,
      unread_count: 1,
      last_message_at: new Date(Date.UTC(2026, 9, 13, 12, 0, 0) - index * 60_000).toISOString(),
    }));
    const service = new AttentionService(
      { inbox: vi.fn().mockResolvedValue({
        portal: "principal",
        generated_at: "2026-10-13T00:00:00.000Z",
        scope: { school_id: schoolId, school_name: "School", timezone: "Asia/Kolkata", student_id: null, student_name: null },
        summary: { total: 0, urgent: 0, high: 0, normal: 0, categories: {} },
        items: [],
      }) } as unknown as RequestsService,
      { attentionItems: vi.fn().mockResolvedValue({ summary: {}, items: [] }) } as unknown as NoticesService,
      { attentionConversations: vi.fn().mockResolvedValue({ results: conversations }) } as unknown as ChatService,
      emptyNotificationAttention(),
    );

    const result = await service.inbox({ id: "33333333-3333-4333-8333-333333333333" } as AuthUser, { portal: "principal" });

    expect(result.modules.messages).toMatchObject({ total: 101, new: 101 });
    expect(result.items).toHaveLength(101);
    expect(result.items.some((item) => item.source_id === "conversation-100")).toBe(true);
  });

  it("rejects an invalid portal before invoking either projection", async () => {
    const requestInbox = vi.fn(); const noticeAttention = vi.fn();
    const service = new AttentionService(
      { inbox: requestInbox } as unknown as RequestsService,
      { attentionItems: noticeAttention } as unknown as NoticesService,
      { attentionConversations: vi.fn() } as unknown as ChatService,
      emptyNotificationAttention(),
    );
    await expect(service.inbox({ id: "user" } as AuthUser, { portal: "student" })).rejects.toThrow("attention context");
    expect(requestInbox).not.toHaveBeenCalled();
    expect(noticeAttention).not.toHaveBeenCalled();
  });
});
