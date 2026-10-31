export interface GateVisitArrangementTable {
  id: string;
  school_id: string;
  person_id: string | null;
  guest_name: string | null;
  party_size: number;
  title: string;
  starts_at: Date;
  ends_at: Date;
  place_id: string | null;
  destination_campus_id: string | null;
  contact_person_id: string;
  state: 'confirmed' | 'cancelled';
  revision: number;
  created_by_person_id: string;
  created_by_user_id: string;
  updated_by_person_id: string;
  updated_by_user_id: string;
  created_at: Date;
  updated_at: Date;
  cancelled_at: Date | null;
  last_movement_direction: 'in' | 'out' | null;
  last_movement_at: Date | null;
  last_movement_count: number | null;
  last_movement_command_id: string | null;
  last_command_id: string;
  last_domain_event_id: string | null;
}

export interface GateVisitArrangementRevisionTable {
  school_id: string;
  visit_id: string;
  revision: number;
  action: 'arranged' | 'changed' | 'cancelled' | 'movement_recorded';
  command_id: string;
  actor_person_id: string;
  actor_user_id: string;
  recorded_at: Date;
  guest_label: string;
  place_label: string;
  contact_label: string;
  actor_label: string;
  snapshot: unknown;
}
