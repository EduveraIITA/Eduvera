import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
type Reference = { attempt_id: string; kind: "review" | "revision"; message_id: string; source_revision: number };
export type AssignmentHandoverReferences = Map<string, Reference[]>;
/** Batch the current references for ordinary Work reads rather than adding a query per person. */
export async function assignmentHandoverReferences(tx: Transaction<Database>, schoolId: string, attemptIds: string[]): Promise<AssignmentHandoverReferences> {
  const found: AssignmentHandoverReferences = new Map(), ids = [...new Set(attemptIds)];
  if (!ids.length) return found;
  const rows = await tx.selectFrom("learning_assignment_handover_messages").select(["attempt_id", "kind", "message_id", "source_revision"])
    .where("school_id", "=", schoolId).where("attempt_id", "in", ids).orderBy("source_revision", "desc").execute();
  for (const row of rows) found.set(row.attempt_id, [...found.get(row.attempt_id) ?? [], row]);
  return found;
}
/** Original attempt references stay immutable; explicit handovers retain the current exact protocol references. */
export async function currentAssignmentAttempt<T extends { id: string; review_message_id: string | null; revision_message_id: string | null }>(tx: Transaction<Database>, schoolId: string, assignmentId: string, attempt: T | undefined, references?: AssignmentHandoverReferences): Promise<T | undefined> {
  if (!attempt) return attempt;
  // Exact assignment is checked by the native caller; same-school composite FK retains source lineage.
  const messages = references?.get(attempt.id) ?? (references ? [] : await tx.selectFrom("learning_assignment_handover_messages").select(["kind", "message_id", "source_revision"])
    .where("school_id", "=", schoolId).where("assignment_id", "=", assignmentId).where("attempt_id", "=", attempt.id).orderBy("source_revision", "desc").execute());
  return { ...attempt, review_message_id: messages.find(row => row.kind === "review")?.message_id ?? attempt.review_message_id,
    revision_message_id: messages.find(row => row.kind === "revision")?.message_id ?? attempt.revision_message_id };
}
