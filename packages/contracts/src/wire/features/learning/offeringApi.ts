/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface OfferingPerson { id: string; name: string; revision: number }

/** Optional academic binding; a basic learning group requires none of these. */
export interface LearningOfferingAcademicInput {
  term_id: string; subject_id: string; course_code: string; credits: number; programme_key: string | null;
}
export interface LearningOfferingAcademicContext extends LearningOfferingAcademicInput {
  term_name: string; academic_year: string; starts_on: string; ends_on: string;
  subject_name: string; color: string; icon: string;
}
export interface LearningOfferingAcademicReferences {
  terms: Array<{ id: string; name: string; academic_year: string; starts_on: string; ends_on: string }>;
  subjects: Array<{ id: string; name: string; code?: string; color: string; icon: string }>;
}
export interface LearningOfferingAcademicCommand {
  command_id: string; expected_revision: number; academic_context: LearningOfferingAcademicInput;
}
export interface LearningOfferingAcademicReceipt {
  id: string; revision: number; action: 'academic.configure'; academic_context: LearningOfferingAcademicContext; replayed: boolean;
}
export interface LearningOfferingReference {
  id: string; name: string; revision: number; learner_count: number; current_instructor?: { person_id: string; name: string } | null; academic_context: LearningOfferingAcademicContext | null;
}

export interface LearningOfferingSummary {
  id: string; name: string; revision: number; can_manage: boolean; can_publish: boolean; can_review: boolean;
  own_enrollment: { id: string; person_id: string; revision: number } | null;
  current_instructor: { id: string; person_id: string; name: string; revision: number } | null;
  learner_count?: number;
  academic_context?: LearningOfferingAcademicContext | null;
}

export interface LearningOfferingList {
  can_create: boolean; actor_person: OfferingPerson | null; timezone: string; today: string;
  items: LearningOfferingSummary[]; page: number; has_more: boolean;
  academic_references?: LearningOfferingAcademicReferences;
}

export interface LearningOfferingDetail extends LearningOfferingSummary {
  starts_on: string; today: string; timezone: string; enrollment_change_mode?: "initial_setup" | "reviewed_change";
  enrollments: Array<{ id: string; person_id: string; name: string; revision: number; starts_on: string; ends_on: string | null }>;
}
