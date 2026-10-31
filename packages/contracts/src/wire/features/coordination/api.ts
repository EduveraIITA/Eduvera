/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export type FollowupContext = "staff" | "guardian";

export interface Followup {
  id: string; student_id: string; student_name: string; owner_name: string;
  attendance_date: string; question: string; due_at: string; overdue: boolean;
  state: "awaiting_response" | "in_review" | "resolved"; revision: number;
  outcome: "absence_explained" | "record_corrected" | "query_withdrawn" | null;
  updated_at: string; created_at: string;
}

export interface FollowupDetail extends Followup {
  can_resolve: boolean;
  coordination?: { status: "historical_unlinked" | "routed" | "manual_followup" | "closed"; message: string; exception_code?: string };
  entries: Array<{ id: string; kind: string; channel: string; body: string; actor_name: string;
    guardian_name: string | null; observed_at: string; recorded_at: string }>;
  guardians: Array<{ id: string; name: string }>;
}

export interface FollowupEntryInput {
  context: FollowupContext; kind: "guardian_reply" | "assisted_reply" | "resolved";
  body: string; expected_revision: number; idempotency_key: string;
  channel?: "app" | "phone" | "paper" | "in_person"; guardian_id?: string; observed_at?: string;
  outcome?: Followup["outcome"];
}
