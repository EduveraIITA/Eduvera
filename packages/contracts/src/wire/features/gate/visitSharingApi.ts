/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
import type { Invitation } from '../onboarding/api';
import type { VisitPerson, VisitPlace } from './visitApi';

export interface SharedVisit {
  id: string; revision: number; title: string; guest_label: string; party_size: number;
  starts_at: string; ends_at: string; state: "confirmed" | "cancelled";
  place: VisitPlace; contact: { label: string };
}

export interface VisitQuestionEntry { id: string; kind: "question" | "reply"; note: string; recorded_at: string; author: "organiser" | "campus"; author_label: string }

export interface VisitQuestion { id: string; revision: number; state: "waiting_for_review" | "answered" | "withdrawn"; entries: VisitQuestionEntry[]; entries_has_more: boolean }

export interface SharedVisitChange { revision: number; recorded_at: string; title: string; starts_at: string; ends_at: string; state: SharedVisit["state"]; party_size: number; place_label: string; contact_label: string }

export interface SharedVisitDetail {
  timezone: string;
  visit: SharedVisit;
  share: { id: string; root_id: string; revision: number; starts_at: string; ends_at: string; directions: string; owner: { label: string; available: boolean }; can_ask: boolean; can_reply: boolean };
  changes: SharedVisitChange[]; changes_has_more: boolean; question: VisitQuestion | null;
}

export interface VisitSharing {
  visit_revision: number; share_revision: number; can_share: boolean; can_open_shared: boolean;
  current: null | {
    id: string; root_id: string; revision: number; organiser: VisitPerson & { has_app_access: boolean };
    starts_at: string; ends_at: string; directions: string; state: "active" | "expired" | "revoked" | "party_changed";
    owner: { id: string; label: string; available: boolean }; can_renew: boolean; can_revoke: boolean; can_takeover: boolean;
    invitation: Pick<Invitation, "id" | "email" | "expires_at" | "accepted_at" | "revoked_at" | "delivery" | "delivery_job_id"> | null;
  };
}
