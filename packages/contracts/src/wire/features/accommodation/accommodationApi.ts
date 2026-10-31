/** Shared declaration-only contracts used by the universal frontend.
 * Keep domain authority and HTTP execution with the owning services. */
export interface AccommodationRef { id: string; label: string; kind?: string; campus_id?: string }

export type AllocationMode = "whole_room" | "shared";

export type AccessMode = "no_tracked_item" | "existing_access" | "tracked_required";

export type ArrangementBasis = "coordinator_allocation" | "resident_offer";

export type StayAction = "accept" | "decline" | "record_response" | "move_in" | "move_out" | "extend" | "change_end" | "accept_extension" | "decline_extension" | "cancel" | "correct_move" | "reassign" | "close";

export interface RoomType { id: string; revision: number; name: string; default_capacity: number; allocation_mode: AllocationMode; active: boolean }

export interface RoomPlace { id: string; revision: number; label: string; holding: AccommodationRef | null; active: boolean }

export interface AccommodationRoom {
  id: string; revision: number; space: AccommodationRef; room_type: AccommodationRef; sleeping_capacity: number;
  allocation_mode: AllocationMode; active: boolean; places: RoomPlace[]; furnishings: Array<AccommodationRef & { asset_tag?: string | null; quantity?: number; state?: string }>; furnishings_has_more?: boolean; location_path?: AccommodationRef[];
}

export interface StaySummary {
  id: string; revision: number; state: string; arrangement_basis: ArrangementBasis; resident: AccommodationRef; coordinator: AccommodationRef; recorder: AccommodationRef;
  room: AccommodationRef; place: AccommodationRef | null; planned_starts_at: string; planned_ends_at: string; proposed_ends_at: string | null;
  actual_move_in_at: string | null; actual_move_out_at: string | null; overstayed: boolean; updated_at: string;
}

export interface AccommodationHistory { id: string; action: string; actor_label: string; occurred_at: string; observed_at: string | null; note: string | null; method: string | null; movement_kind?: "move_in" | "move_out" | null; movement_retracted?: boolean; response?: "accept" | "decline" | null; response_for?: "offer" | "extension" | null; planned_ends_at?: string | null; proposed_ends_at?: string | null }

export interface AccommodationAccessLoan { id: string; loan_id: string; item: AccommodationRef; return_required: boolean; outstanding: number; href: string | null; can_open: boolean; can_return: boolean }

export interface StayRecord extends StaySummary {
  instructions: string; origin_space: AccommodationRef | null; origin_note: string; destination_space: AccommodationRef | null; destination_note: string;
  repair: (AccommodationRef & { href: string | null; state: string }) | null; access_mode: AccessMode;
  access_loans: AccommodationAccessLoan[]; access_settled: boolean; route_unavailable: boolean; recovery_only: false; access_transferred?: boolean;
  allowed_actions: Record<StayAction | "link_access", boolean>; history: AccommodationHistory[];
  history_pagination: { page: number; page_size: number; total: number };
}

export interface StayRecovery {
  id: string; revision: number; state: string; recovery_only: true; route_unavailable: true;
  coordinator_unavailable?: boolean; recorder_unavailable?: boolean;
  allowed_actions: Partial<Record<StayAction | "link_access", boolean>>; history: AccommodationHistory[];
  history_pagination: { page: number; page_size: number; total: number };
}

export type StayDetail = StayRecord | StayRecovery;

export interface AccommodationPage {
  view: "stays" | "rooms"; can_manage: boolean; can_offer: boolean; stays: StaySummary[]; rooms: AccommodationRoom[]; room_types: RoomType[];
  totals: { active: number; offered: number; occupied: number; closed: number }; pagination: { page: number; page_size: number; total: number };
}

export interface AccommodationOptions {
  actor: AccommodationRef | null; people: Array<AccommodationRef & { has_app: boolean }>; spaces: AccommodationRef[];
  room_types: RoomType[]; rooms: AccommodationRoom[]; holdings: AccommodationRef[];
  campuses?: Array<AccommodationRef & { is_primary?: boolean }>;
  people_has_more: boolean; spaces_has_more: boolean; rooms_has_more: boolean; holdings_has_more: boolean; room_types_has_more?: boolean; can_manage: boolean; can_offer: boolean; can_add_people?: boolean;
}
