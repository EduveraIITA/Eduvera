/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface AssignmentItem {
  id: string; school_id: string; class_section_id: string | null; term_id: string | null; subject_id: string | null; author_id: string; reviewer_id: string;
  context_kind?: "class_term" | "learning_offering"; offering_id?: string | null;
  title: string; instructions: string; due_at: string | null; cutoff_at: string | null; state: "draft" | "published"; revision: number;
  published_at: string | null; submission_mode: "text" | "files" | "either"; max_attempts: number | null; policy_version: 1; resubmission_mode: "on_request";
}

export interface AssignmentList {
  context: "class" | "offering" | "learner"; can_create: boolean; can_general?: boolean; timezone: string;
  class_section?: { id: string; label: string }; student?: { id: string; name: string } | null;
  offering?: { id: string; name: string; revision: number }; learner?: { id: string; person_id: string; name: string };
  terms?: Array<{ id: string; name: string }>; subjects?: Array<{ id: string; name: string }>;
  reviewers?: Array<{ id: string; name: string; subject_id: string | null }>;
  items: AssignmentItem[]; page: number; has_more: boolean;
}

export interface AssignmentFile { id: string; original_name: string; content_type: string; size_bytes: number; sha256: string }

export interface AssignmentAttempt {
  id: string; attempt_number: number; body: string; submitted_at: string; manifest_hash: string; late: boolean; files: AssignmentFile[];
  review: { id: string; decision: "reviewed" | "request_changes"; feedback: string; reviewed_at: string } | null;
}

export interface AssignmentWork {
  context: "reviewer" | "learner"; item: AssignmentItem; timezone: string; student?: { id: string; name: string } | null;
  learner?: { id: string; person_id: string; name: string };
  state: "not_started" | "draft" | "submitted" | "changes_requested" | "reviewed";
  can_write: boolean; can_review: boolean; can_request_changes?: boolean; can_submit?: boolean; submission_blocked_reason?: string | null; draft: { body: string; revision: number; updated_at: string | null } | null;
  files: AssignmentFile[]; attempts: AssignmentAttempt[];
}

export interface AssignmentClassDetail {
  context: "class" | "offering"; item: AssignmentItem; timezone: string; can_review: boolean; can_edit: boolean;
  publication_preview: { count: number; audience_hash: string } | null;
  progress: { items: Array<{ id: string; name: string; status: string }>; total: number; submitted: number; needs_review: number; page: number; has_more: boolean };
}
