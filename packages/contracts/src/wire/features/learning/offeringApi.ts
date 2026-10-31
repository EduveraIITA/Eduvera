/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface OfferingPerson { id: string; name: string; revision: number }

export interface LearningOfferingSummary {
  id: string; name: string; revision: number; can_manage: boolean; can_publish: boolean; can_review: boolean;
  own_enrollment: { id: string; person_id: string; revision: number } | null;
  current_instructor: { id: string; person_id: string; name: string; revision: number } | null;
  learner_count?: number;
}

export interface LearningOfferingList {
  can_create: boolean; actor_person: OfferingPerson | null; timezone: string; today: string;
  items: LearningOfferingSummary[]; page: number; has_more: boolean;
}

export interface LearningOfferingDetail extends LearningOfferingSummary {
  starts_on: string; today: string; timezone: string;
  enrollments: Array<{ id: string; person_id: string; name: string; revision: number; starts_on: string; ends_on: string | null }>;
}
