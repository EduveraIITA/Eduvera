import type { Generated } from "kysely";
export type AllocationMode = "whole_room" | "shared";
export type ArrangementBasis = "coordinator_allocation" | "resident_offer";
export type StayState =
  | "offered"
  | "accepted"
  | "declined"
  | "cancelled"
  | "closed";
export type AccessMode =
  | "no_tracked_item"
  | "existing_access"
  | "tracked_required";
export type StayAction =
  | "offered"
  | "allocated"
  | "accepted"
  | "declined"
  | "response_recorded"
  | "moved_in"
  | "moved_out"
  | "extension_offered"
  | "extension_accepted"
  | "extension_declined"
  | "end_changed"
  | "cancelled"
  | "movement_corrected"
  | "reassigned"
  | "closed"
  | "access_linked";
export interface AccommodationRoomTypeTable {
  id: string;
  school_id: string;
  name: string;
  default_capacity: number;
  allocation_mode: AllocationMode;
  active: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
export interface AccommodationRoomTable {
  id: string;
  school_id: string;
  space_id: string;
  room_type_id: string;
  sleeping_capacity: number;
  allocation_mode: AllocationMode;
  active: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
export interface AccommodationPlaceTable {
  id: string;
  school_id: string;
  room_id: string;
  label: string;
  holding_id: string | null;
  active: boolean;
  revision: number;
  created_at: Date;
  updated_at: Date;
}
export interface AccommodationStayTable {
  id: string;
  school_id: string;
  resident_person_id: string;
  coordinator_person_id: string;
  recorder_person_id: string;
  recorded_by_user_id: string;
  room_id: string;
  place_id: string | null;
  repair_id: string | null;
  origin_space_id: string | null;
  origin_note: string;
  instructions: string;
  access_mode: AccessMode;
  arrangement_basis: Generated<ArrangementBasis>;
  state: StayState;
  planned_starts_at: Date;
  planned_ends_at: Date;
  proposed_ends_at: Date | null;
  accepted_at: Date | null;
  actual_move_in_at: Date | null;
  actual_move_out_at: Date | null;
  destination_space_id: string | null;
  destination_note: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
  coordination_receipt: Generated<unknown>;
}
export interface AccommodationReceiptTable {
  id: string;
  school_id: string;
  stay_id: string;
  revision: number;
  command_id: string;
  action: StayAction;
  arrangement_basis: Generated<ArrangementBasis>;
  actor_person_id: string;
  actor_user_id: string;
  note: string;
  observed_at: Date | null;
  method: "in_person" | "phone" | "written" | null;
  response: "accept" | "decline" | null;
  response_for: "offer" | "extension" | null;
  supersedes_receipt_id: string | null;
  movement_kind: "move_in" | "move_out" | null;
  movement_retracted: boolean;
  state: StayState;
  coordinator_person_id: string;
  recorder_person_id: string;
  planned_starts_at: Date;
  planned_ends_at: Date;
  proposed_ends_at: Date | null;
  accepted_at: Date | null;
  actual_move_in_at: Date | null;
  actual_move_out_at: Date | null;
  destination_space_id: string | null;
  destination_note: string;
  recorded_at: Date;
}
export interface AccommodationSetupReceiptTable {
  id: string;
  school_id: string;
  source_id: string;
  kind: "room_type" | "room" | "place";
  revision: number;
  command_id: string;
  actor_person_id: string;
  actor_user_id: string;
  name: string;
  default_capacity: number | null;
  allocation_mode: AllocationMode | null;
  space_id: string | null;
  room_type_id: string | null;
  sleeping_capacity: number | null;
  room_id: string | null;
  holding_id: string | null;
  active: boolean;
  reason: string;
  recorded_at: Date;
}
export interface AccommodationAccessLoanTable {
  id: string;
  school_id: string;
  stay_id: string;
  loan_id: string;
  return_required: boolean;
  receipt_revision: number;
  created_at: Date;
}
