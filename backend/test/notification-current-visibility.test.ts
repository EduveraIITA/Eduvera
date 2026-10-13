import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "migrations", "073_notification_current_visibility.sql"),
  "utf8",
);
const optimizationMigration = readFileSync(
  join(process.cwd(), "migrations", "074_notification_event_visibility_performance.sql"),
  "utf8",
);
const precedenceMigration = readFileSync(
  join(process.cwd(), "migrations", "075_typed_notification_visibility_precedence.sql"),
  "utf8",
);
const safeguardingLinkMigration = readFileSync(
  join(process.cwd(), "migrations", "077_exact_safeguarding_report_links.sql"),
  "utf8",
);
const schoolService = readFileSync(
  join(process.cwd(), "src", "school", "school.service.ts"),
  "utf8",
);
const chatService = readFileSync(
  join(process.cwd(), "src", "chat", "chat.service.ts"),
  "utf8",
);
const chatLinks = readFileSync(
  join(process.cwd(), "src", "chat", "chat-links.ts"),
  "utf8",
);
const requestsService = readFileSync(
  join(process.cwd(), "src", "requests", "requests.service.ts"),
  "utf8",
);

describe("current notification visibility", () => {
  it("rechecks every bell surface and both home badge fallbacks", () => {
    expect(migration).toContain("CREATE FUNCTION notification_is_currently_visible(");
    expect(schoolService.match(/notification_is_currently_visible\(/g)).toHaveLength(5);

    const listAndCount = schoolService.slice(
      schoolService.indexOf("async notifications"),
      schoolService.indexOf("async markNotificationRead"),
    );
    expect(listAndCount.match(/notification_is_currently_visible\(/g)).toHaveLength(2);

    const acknowledgement = schoolService.slice(
      schoolService.indexOf("async markNotificationRead"),
      schoolService.indexOf("async parentHome"),
    );
    expect(acknowledgement).toContain("notification_is_currently_visible(");
    expect(acknowledgement).toContain("currentAuthorization.rows[0]?.allowed");
  });

  it("fails closed for known school sources but preserves source-free personal alerts", () => {
    expect(migration).toContain("notification_attention_is_currently_authorized(notification.id,actor)");
    expect(migration).toContain("event_user_is_authorized(");
    expect(migration).toContain("school_notice_recipients recipient");
    expect(migration).toContain("chat_actor_is_current_participant(");
    expect(migration).toContain("assessment_publications publication");
    expect(migration).toContain("grading_report_batches batch");
    expect(migration).toContain("leave_requests request");
    expect(migration).toContain("notification_actor_has_current_student_scope(");
    expect(migration).toContain("ELSE true");
  });

  it("dispatches high-volume generic event rows through source-aware live checks", () => {
    expect(optimizationMigration).toContain("LANGUAGE plpgsql STABLE SECURITY INVOKER");
    expect(optimizationMigration).toContain("CREATE FUNCTION notification_event_is_currently_visible(");
    expect(optimizationMigration).toContain("source.event_type='attendance.register.overdue'");
    expect(optimizationMigration).toContain("effective_school_schedule(");
    expect(optimizationMigration).toContain("source.event_type='attendance.updated'");
    expect(optimizationMigration).toContain("notification_actor_has_current_student_scope(");
    expect(optimizationMigration).toContain("source.event_type='staff.leave.submitted'");
    expect(optimizationMigration).toContain("source.event_type='governance.policy.submitted'");
    expect(optimizationMigration).toContain("RETURN event_user_is_authorized(");
    expect(optimizationMigration).not.toContain("source.audience_user_ids");
    expect(precedenceMigration).toContain("IF notification_attention THEN");
    expect(precedenceMigration.indexOf("IF notification_attention THEN"))
      .toBeLessThan(precedenceMigration.indexOf("IF notification_dedupe ~*"));
    expect(precedenceMigration).toContain("notification_is_currently_visible_before_event_optimization(");
  });

  it("limits report-review alerts to a current assigned reviewer or administrator", () => {
    expect(migration).toContain("CREATE FUNCTION notification_chat_report_is_current_reviewer(");
    expect(migration).toContain("report.status IN ('open','under_review')");
    expect(migration).toContain("membership.role='admin'");
    expect(migration).toContain("report.assigned_to=membership.user_id");
    expect(migration).toContain("'safeguarding.review'=ANY(binding.permissions)");
    expect(migration).toContain("binding.status='active'");
    expect(chatService.match(/'safeguarding\.review'=ANY\(binding\.permissions\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(chatService).toContain("Choose an authorised staff member.");
  });

  it("gives assigned teacher reports an exact actionable Requests destination", () => {
    expect(requestsService).toContain("private async teacherSafeguardingReportItems(");
    expect(requestsService).toContain("report.assigned_to=${user.id}::uuid");
    expect(requestsService).toContain("report.status IN ('open','under_review')");
    expect(requestsService).toContain("safeguardingReportAttentionHref(\"teacher\", row.id)");
    expect(requestsService).toContain("safeguardingReportAttentionHref(\"principal\", row.id)");
    expect(chatLinks).toContain("/safeguarding?section=message_reports&report=${encodeURIComponent(reportId)}");
  });

  it("routes moderation notices to the exact report or conversation and repairs historical blank links", () => {
    expect(chatService).toContain('safeguardingReportAttentionHref("principal", saved.id)');
    expect(chatService).toContain("safeguardingReportAttentionHref(targetPortal, reportId)");
    expect(chatService).toContain('safeguardingReportAttentionHref("principal", reportId)');
    expect(chatService).toContain("link: conversationLink(report.sender_role, report.conversation_id, report.context_student_id)");
    expect(chatService).not.toContain('title: "Messaging temporarily restricted",\n          body: `School staff restricted messaging for ${data.restriction_days ?? 7} day(s).`,\n          link: ""');
    expect(migration).toContain("notification.title='Messaging temporarily restricted'");
    expect(migration).toContain("notification.link=''");
    expect(migration).toContain("'conversation_id',conversation.id");
    expect(safeguardingLinkMigration).toContain("/safeguarding?section=message_reports&report=");
    expect(safeguardingLinkMigration).toContain("report.id::text=notification.metadata->>'report_id'");
    expect(safeguardingLinkMigration).not.toMatch(/notification\.(title|body)\s*(=|LIKE|~)/);
  });
});
