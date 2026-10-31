/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface VisitPerson { id: string; label: string; revision: number; avatar_url?: string | null; has_app_access?: boolean }

export interface VisitPlace { id: string; label: string; kind: string; campus_label?: string | null }

export interface ArrangedVisit {
  id: string; revision: number; title: string;
  person: VisitPerson | null; guest_name: string | null; guest_label: string; party_size: number;
  starts_at: string; ends_at: string; place: VisitPlace; contact: VisitPerson;
  state: "confirmed" | "cancelled"; created_at: string; updated_at: string; cancelled_at: string | null;
  last_movement: { direction: "in" | "out"; occurred_at: string; observed_count: number } | null;
}

export interface VisitDetail {
  visit: ArrangedVisit; can_edit: boolean; can_cancel: boolean;
  can_record_arrival: boolean; can_record_exit: boolean;
  history?: VisitHistory[]; history_has_more?: boolean;
}

export interface VisitHistory {
  revision: number; action: "arranged" | "changed" | "cancelled" | "movement_recorded";
  recorded_at: string; actor: { id: string; label: string }; title: string;
  guest_name: string | null; guest_label?: string; person_id: string | null; party_size: number;
  starts_at: string; ends_at: string; place_id: string | null; campus_id?: string | null; place_label?: string;
  contact_person_id: string; contact_label?: string; state: "confirmed" | "cancelled";
  last_movement: ArrangedVisit["last_movement"];
}

export interface VisitOptions {
  actor: { person_id: string; label: string; revision: number } | null;
  people: VisitPerson[]; places: VisitPlace[]; campuses?: VisitPlace[]; timezone: string;
  pagination: { page: number; page_size: number; people_has_more: boolean; places_has_more: boolean };
}

export interface VisitInput {
  person_id: string | null; person_revision: number | null; guest_name: string | null;
  party_size: number; title: string; starts_at: string; ends_at: string;
  place_id: string | null; campus_id?: string | null; contact_person_id: string; contact_revision: number;
}
