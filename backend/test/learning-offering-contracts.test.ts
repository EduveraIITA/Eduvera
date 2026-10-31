import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assignmentDraft, learningAssignmentDraft, learningOfferingCreate } from "../src/learning/learning-assignment.contracts.js";
import { assignmentContinuationPath, parseAssignmentContinuation } from "../src/learning/learning-assignment-readiness.js";

describe("typed learning context compatibility", () => {
  it("keeps legacy normalized assignment commitments unchanged and rejects mixed contexts", () => {
    const old = { command_id: randomUUID(), expected_revision: 0, assignment_id: randomUUID(), class_section_id: randomUUID(), term_id: randomUUID(), reviewer_id: randomUUID(), title: "Practice", instructions: "Explain your answer" };
    expect(learningAssignmentDraft.parse(old)).toEqual(assignmentDraft.parse(old));
    expect(learningAssignmentDraft.parse(old)).not.toHaveProperty("context_kind");
    expect(learningAssignmentDraft.parse(old)).not.toHaveProperty("offering_id");
    expect(learningAssignmentDraft.safeParse({ ...old, context_kind: "learning_offering", offering_id: randomUUID() }).success).toBe(false);
  });
  it("requires unique explicit canonical People references", () => {
    const person = { id: randomUUID(), expected_revision: 2 };
    const input = { command_id: randomUUID(), offering_id: randomUUID(), name: "Robotics", participants: [person], instructor: { id: randomUUID(), expected_revision: 3 }, starts_on: "2026-10-23" };
    expect(learningOfferingCreate.parse(input)).toEqual(input);
    expect(learningOfferingCreate.safeParse({ ...input, participants: [person, person] }).success).toBe(false);
    expect(learningOfferingCreate.safeParse({ ...input, participants: [{ id: person.id }] }).success).toBe(false);
  });
  it.each(["class_term", "learning_offering"] as const)("retains bounded exact %s continuation context without a redirect", kind => {
    const source = { id: randomUUID(), revision: 123, context_kind: kind, class_section_id: kind === "class_term" ? randomUUID() : null, offering_id: kind === "learning_offering" ? randomUUID() : null };
    const path = assignmentContinuationPath(source);
    expect(path.length).toBeLessThanOrEqual(180);
    expect(parseAssignmentContinuation(path)).toEqual({ id: source.id, context_kind: kind, context_id: source.offering_id ?? source.class_section_id, expected_revision: 123 });
    for (const value of [`${path}&revision=123`, `${path}&next=https://attacker.invalid`, `${path}#later`, `https://attacker.invalid${path}`, path.replace("revision=123", "revision=0")])
      expect(parseAssignmentContinuation(value)).toBeNull();
  });
});
