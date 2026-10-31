import { apiFetch } from "../../lib/api";

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
export interface AccommodationCommand { command_id: string; expected_revision: number }
export interface StayInput {
  arrangement_basis: ArrangementBasis;
  resident_person_id: string; room_id: string; place_id: string | null; coordinator_person_id: string; recorder_person_id: string;
  repair_id: string | null; origin_space_id: string | null; origin_note: string; starts_at: string; ends_at: string; instructions: string; access_mode: AccessMode;
}
export interface StayActionInput {
  action: StayAction; note?: string; observed_at?: string; method?: "in_person" | "phone" | "written"; response?: "accept" | "decline";
  response_for?: "offer" | "extension"; ends_at?: string; destination_space_id?: string | null; destination_note?: string;
  coordinator_person_id?: string; recorder_person_id?: string; supersedes_receipt_id?: string; movement?: "move_in" | "move_out"; retract?: boolean;
}
export interface AccommodationConfirmation { state: "not_found" | "pending" | "not_accepted" | "accepted"; result?: { id: string; revision: number; access_transferred?: boolean } }
export interface RoomTypeInput { id?: string; name: string; default_capacity: number; allocation_mode: AllocationMode; active: boolean; reason?: string }
export interface RoomInput { id?: string; space_id: string; room_type_id: string; sleeping_capacity: number; allocation_mode: AllocationMode; active: boolean; reason?: string }
export interface PlaceInput { id?: string; room_id: string; label: string; holding_id: string | null; active: boolean; reason?: string }
const root = (schoolId: string) => `/api/v1/schools/${encodeURIComponent(schoolId)}/facilities/accommodation`;
const stay = (schoolId: string, id: string) => `${root(schoolId)}/stays/${encodeURIComponent(id)}`;
const post = <T>(path: string, body: unknown) => apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) });
export const getAccommodation = (schoolId: string, query: { view: "stays" | "rooms"; state: "active" | "closed" | "all"; search: string; page: number }) =>
  apiFetch<AccommodationPage>(`${root(schoolId)}/workspace?${new URLSearchParams({ ...query, page: String(query.page) })}`);
export const getAccommodationOptions = (schoolId: string, query: { search?: string; page?: number; stay_id?: string; repair_id?: string; person_id?: string; room_id?: string; room_type_id?: string; place_id?: string } = {}) => {
  const params = new URLSearchParams(); for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return apiFetch<AccommodationOptions>(`${root(schoolId)}/options?${params}`);
};
export const getAccommodationRoom = (schoolId: string, id: string) => apiFetch<AccommodationRoom>(`${root(schoolId)}/rooms/${encodeURIComponent(id)}`);
export const saveRoomType = (schoolId: string, input: AccommodationCommand & RoomTypeInput) => post<RoomType>(`${root(schoolId)}/room-types`, input);
export const saveAccommodationRoom = (schoolId: string, input: AccommodationCommand & RoomInput) => post<AccommodationRoom>(`${root(schoolId)}/rooms`, input);
export const saveRoomPlace = (schoolId: string, input: AccommodationCommand & PlaceInput) => post<RoomPlace>(`${root(schoolId)}/places`, input);
export const offerAccommodation = (schoolId: string, input: AccommodationCommand & StayInput) => post<StayDetail>(`${root(schoolId)}/stays`, input);
export const getStay = (schoolId: string, id: string, historyPage = 1) => apiFetch<StayDetail>(`${stay(schoolId, id)}?${new URLSearchParams({ history_page: String(historyPage) })}`);
export const actOnStay = (schoolId: string, id: string, input: AccommodationCommand & StayActionInput) => post<StayDetail>(`${stay(schoolId, id)}/actions`, input);
export const linkStayAccess = (schoolId: string, id: string, input: AccommodationCommand & { loan_id: string; return_required: boolean; note?: string }) => post<StayDetail>(`${stay(schoolId, id)}/access-loans`, input);
export const confirmAccommodationCommand = (schoolId: string, id: string, commandId: string, setup = false) =>
  apiFetch<AccommodationConfirmation>(`${setup ? `${root(schoolId)}/setup` : stay(schoolId, id)}/confirmation?${new URLSearchParams({ command_id: commandId })}`);
