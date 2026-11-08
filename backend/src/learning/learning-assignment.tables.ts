import type { ColumnType } from "kysely";

type Instant = ColumnType<Date, Date | string, Date | string>;
type OptionalInstant = ColumnType<Date | null, Date | string | null, Date | string | null>;
export interface LearningAssignmentTable {
  id: string; school_id: string; context_kind: ColumnType<"class_term" | "learning_offering", "class_term" | "learning_offering" | undefined>;
  offering_id: ColumnType<string | null, string | null | undefined>; class_section_id: string | null; term_id: string | null; subject_id: string | null;
  author_person_id: ColumnType<string | null, string | null | undefined>; reviewer_person_id: ColumnType<string | null, string | null | undefined>;
  author_id: string; reviewer_id: string; title: string; instructions: string; due_at: OptionalInstant;
  cutoff_at: OptionalInstant; submission_mode: "text" | "files" | "either"; max_attempts: number | null; policy_version: 1; resubmission_mode: "on_request";
  state: "draft" | "published"; revision: number; published_at: OptionalInstant;
  review_route_version_id: string | null; review_subscription_id: string | null;
  revision_route_version_id: string | null; revision_subscription_id: string | null;
  created_at: Instant; updated_at: Instant;
}
export interface LearningAssignmentAudienceTable {
  school_id: string; assignment_id: string; learner_id: string; person_id: string; student_id: string | null;
  enrollment_id: string | null; offering_enrollment_id: string | null; enrollment_revision: number;
  created_at: Instant;
}
export interface LearningAssignmentDraftTable {
  school_id: string; assignment_id: string; learner_id: string; student_id: string | null; body: string; revision: number;
  updated_by: string; updated_at: Instant;
}
export interface LearningAssignmentFileTable {
  id: string; school_id: string; assignment_id: string; learner_id: string; student_id: string | null; storage_key: string;
  original_name: string; content_type: string; size_bytes: number; sha256: string; draft_attached: boolean;
  uploaded_by: string; created_at: Instant;
}
export interface LearningAssignmentAttemptTable {
  id: string; school_id: string; assignment_id: string; learner_id: string; student_id: string | null; attempt_number: number;
  body: string; manifest_hash: string; submitted_by: string; submitted_at: Instant; draft_revision: number;
  review_message_id: string | null; revision_message_id: string | null;
  revision_route_version_id: string; revision_subscription_id: string; revision_selector_key: string;
}
export interface LearningAssignmentAttemptFileTable {
  school_id: string; attempt_id: string; assignment_id: string; learner_id: string; student_id: string | null; file_id: string; ordinal: number;
}
export interface LearningAssignmentReviewTable {
  id: string; school_id: string; assignment_id: string; learner_id: string; student_id: string | null; attempt_id: string;
  decision: "reviewed" | "request_changes"; feedback: string; reviewed_by: string; reviewed_at: Instant;
}
export interface LearningAssignmentTables {
  learning_offerings: LearningOfferingTable;
  learning_offering_enrollments: LearningOfferingEnrollmentTable;
  learning_offering_teaching_assignments: LearningOfferingTeachingAssignmentTable;
  learning_assignment_review_handovers: LearningAssignmentReviewHandoverTable;
  learning_assignment_handover_messages: LearningAssignmentHandoverMessageTable;
  learning_assignments: LearningAssignmentTable;
  learning_assignment_audience: LearningAssignmentAudienceTable;
  learning_assignment_drafts: LearningAssignmentDraftTable;
  learning_assignment_files: LearningAssignmentFileTable;
  learning_assignment_attempts: LearningAssignmentAttemptTable;
  learning_assignment_attempt_files: LearningAssignmentAttemptFileTable;
  learning_assignment_reviews: LearningAssignmentReviewTable;
}

export interface LearningOfferingTable {
  id: string; school_id: string; name: string; state: "active" | "closed"; revision: number;
  created_by: string; created_at: Instant; updated_at: Instant;
}
export interface LearningOfferingEnrollmentTable {
  id: string; school_id: string; offering_id: string; person_id: string; selected_person_revision: number;
  starts_on: string; ends_on: string | null; revision: number; created_by: string; created_at: Instant;
  ended_by: string | null; ended_at: OptionalInstant; end_reason: string | null;
}
export interface LearningOfferingTeachingAssignmentTable extends LearningOfferingEnrollmentTable {
  can_publish: boolean; can_review: boolean;
}

export interface LearningAssignmentReviewHandoverTable {
  id: string; school_id: string; assignment_id: string; source_revision: number; previous_revision: number;
  previous_reviewer_id: string; previous_reviewer_person_id: string | null; reviewer_id: string; reviewer_person_id: string | null;
  review_route_version_id: string; review_subscription_id: string; command_id: string; assigned_by: string; reason: string; created_at: Instant;
}
export interface LearningAssignmentHandoverMessageTable {
  school_id: string; assignment_id: string; handover_id: string; attempt_id: string; learner_id: string; kind: "review" | "revision";
  source_revision: number; previous_message_id: string | null; message_id: string; created_at: Instant;
}
