export interface GateVisitShareTable {
  id: string; school_id: string; visit_id: string; root_id: string; revision: number;
  organiser_person_id: string; organiser_person_revision: number;
  party_person_id: string | null; party_guest_name: string | null; baseline_visit_revision: number;
  owner_person_id: string; starts_at: Date; ends_at: Date; directions: string;
  status: 'granted' | 'revoked'; action: 'shared' | 'renewed' | 'revoked' | 'taken_over';
  previous_share_id: string | null; actor_person_id: string; actor_user_id: string;
  command_id: string; domain_event_id: string; recorded_at: Date;
}
export interface GateVisitQuestionTable {
  id: string; school_id: string; visit_id: string; share_root_id: string;
  organiser_person_id: string; owner_person_id: string; revision: number;
  state: 'waiting_for_review' | 'answered' | 'withdrawn';
  created_at: Date; updated_at: Date; last_command_id: string; last_domain_event_id: string;
  coordination_receipt: unknown;
}
export interface GateVisitQuestionEntryTable {
  id: string; school_id: string; visit_id: string; question_id: string; revision: number;
  share_id: string; action: 'asked' | 'replied' | 'rerouted' | 'withdrawn';
  note: string; actor_person_id: string; actor_user_id: string; actor_label: string;
  command_id: string; domain_event_id: string; recorded_at: Date;
  snapshot: unknown;
}
