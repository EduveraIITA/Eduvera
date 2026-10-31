import type { FacilitiesOptions, FacilitiesPage, FacilitiesSettings, RepairDetail } from "./facilitiesApi";

/** Fictional records for focused tests only, never application fallback data. */
export const repairSettings = (overrides: Partial<FacilitiesSettings> = {}): FacilitiesSettings => ({ revision: 1, handler_person_id: "handler", handler: { id: "handler", label: "Dev Shah" }, verifier_mode: "reporter", verifier_person_id: null, verifier: null, emergency_contact: "Campus security desk", can_manage: true, configured: true, ...overrides });
export function repairFixture(overrides: Partial<RepairDetail> = {}): RepairDetail {
  return { id: "repair-1", title: "Leaking pipe", problem: "Leaking pipe below the washbasin", state: "reported", revision: 1,
    reporter: { id: "reporter", label: "Asha Patel" }, recorder: { id: "reporter", label: "Asha Patel" }, handler: { id: "handler", label: "Dev Shah" }, verifier: { id: "reporter", label: "Asha Patel" },
    place: { id: "room-1", label: "Hostel room 203" }, item: null, location_note: "Below the washbasin", expected_finish_at: null, wait_reason: null, urgent: false, updated_at: "2026-10-24T08:00:00Z", history: [], photos: [], history_pagination: { page: 1, page_size: 10, total: 1 },
    allowed_actions: { accept: true, assign: true, update: false, complete: false, verify: false, reopen: false, add_photo: true }, ...overrides };
}
export const repairsPage = (overrides: Partial<FacilitiesPage> = {}): FacilitiesPage => ({ view: "mine", repairs: [repairFixture()], can_report: true, can_manage: true, settings: repairSettings(), totals: { open: 1, awaiting_verification: 0, closed: 0 }, pagination: { page: 1, page_size: 10, total: 1 }, ...overrides });
export const repairOptions = (overrides: Partial<FacilitiesOptions> = {}): FacilitiesOptions => ({ actor: { person_id: "handler", label: "Dev Shah" }, people: [{ id: "handler", label: "Dev Shah", has_app_access: true, can_manage: true }, { id: "reporter", label: "Asha Patel", has_app_access: true, can_manage: false }, { id: "passive", label: "Amit Kumar", has_app_access: false, can_manage: false }], places: [{ id: "room-1", label: "Hostel room 203" }], holdings: [], settings: repairSettings(), pagination: { page: 1, page_size: 25, people_has_more: false, places_has_more: false, holdings_has_more: false }, ...overrides });
