import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migration = await readFile(
  new URL("../migrations/068_chat_current_scope_authorization.sql", import.meta.url),
  "utf8",
);

describe("chat current-scope authorization migration", () => {
  it("derives contextual access from current school relationships", () => {
    expect(migration).toContain("CREATE FUNCTION chat_actor_has_student_scope(");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("account.is_active");
    expect(migration).toContain("membership.role='admin'");
    expect(migration).toContain("staff_has_student_permission(tenant,actor,action,context_student.id)");
    expect(migration).toContain("context_student.user_id=membership.user_id");
    expect(migration).toContain("relationship.school_id=context_student.school_id");
    expect(migration).toContain("relationship.student_id=context_student.id");
  });

  it("requires current participation and contextual scope for every conversation action", () => {
    expect(migration).toContain("CREATE FUNCTION chat_actor_is_current_participant(");
    expect(migration).toContain("participant.is_active");
    expect(migration).toContain("membership.is_active");
    expect(migration).toContain("staff_has_conversation_permission(");
    expect(migration).toContain("thread.context_student_id IS NULL");
    expect(migration).toContain("chat_actor_has_student_scope(");
  });

  it("prevents cross-school child references at the database boundary", () => {
    expect(migration).toContain("CONSTRAINT chat_conversation_context_student_school_fk");
    expect(migration).toContain("FOREIGN KEY(school_id,context_student_id)");
    expect(migration).toContain("REFERENCES students(school_id,id)");
    expect(migration).toContain("VALIDATE CONSTRAINT chat_conversation_context_student_school_fk");
  });

  it("rechecks the canonical policy during durable event replay and fails closed on malformed ids", () => {
    expect(migration).toContain("event_name='chat.updated' THEN EXISTS");
    expect(migration).toContain("thread.id::text=event_payload->>'conversation_id'");
    expect(migration).toContain("chat_actor_is_current_participant(");
    expect(migration).not.toContain("NULLIF(event_payload->>'conversation_id','')::uuid");
    expect(migration).toContain("event_user_is_authorized_before_chat_current_scope(");
  });

  it("does not expose authorization helpers to PUBLIC", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION chat_actor_has_student_scope(uuid,uuid,text,uuid) FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON FUNCTION chat_actor_is_current_participant(uuid,uuid,text,uuid) FROM PUBLIC");
    expect(migration).toContain("REVOKE ALL ON FUNCTION event_user_is_authorized(uuid,text,jsonb,uuid) FROM PUBLIC");
  });
});
