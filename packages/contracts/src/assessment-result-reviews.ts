export type ResultReviewState = "submitted" | "resolved" | "correction_requested" | "corrected";

export interface ResultReviewRecipient {
  user_id: string;
  name: string;
}

export interface ResultReview {
  id: string;
  school_id: string;
  assessment_id: string;
  assessment_title: string;
  publication_id: string;
  publication_sequence: number;
  learner_name: string;
  reviewer: ResultReviewRecipient;
  request_note: string;
  response_note: string | null;
  state: ResultReviewState;
  revision: number;
  requested_at: string;
  correction: { publication_id: string; sequence: number } | null;
}

export interface LearnerResultReviews {
  school_id: string;
  person_id: string;
  student_id: string | null;
  assessment_id: string;
  publication_id: string;
  reviewer: ResultReviewRecipient | null;
  unavailable_reason: "already_requested" | "previous_review_open" | "stale_publication" | "reviewer_unavailable" | null;
  reviews: ResultReview[];
}

export interface StaffResultReviewDetail {
  review: ResultReview;
  can_decide: boolean;
  replacement_reviewers: ResultReviewRecipient[];
  source_result_id: string;
}

export interface ResultReviewReceipt {
  review: ResultReview;
  client_key: string;
  accepted_revision: number;
  accepted_reviewer_user_id: string;
  action: "submit" | "reassign" | "resolve" | "refer_correction";
}

export interface StaffResultReviewQueue {
  school_id: string;
  page: number;
  has_more: boolean;
  items: Array<{
    id: string;
    assessment_title: string;
    learner_name: string;
    publication_sequence: number;
    reviewer_name: string;
    state: "submitted" | "correction_requested";
  }>;
}
