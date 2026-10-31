import { apiFetch } from "../../lib/api";
import type { FacilitiesCommand, RepairDetail } from "./facilitiesApi";

const root = (school: string, repair: string) => `/api/v1/schools/${encodeURIComponent(school)}/facilities/repairs/${encodeURIComponent(repair)}/external-access`;
export interface RepairExternalInput extends FacilitiesCommand {
  person_id: string; expected_person_revision: number; ends_at: string; instructions: string; shared_photo_ids: string[];
}
const post = (path: string, body: unknown) => apiFetch<RepairDetail>(path, { method: "POST", body: JSON.stringify(body) });
export const grantRepairExternalAccess = (school: string, repair: string, body: RepairExternalInput) => post(root(school, repair), body);
export const activateRepairExternalAccess = (school: string, repair: string, grant: string, body: FacilitiesCommand) => post(`${root(school, repair)}/${encodeURIComponent(grant)}/activate`, body);
export const endRepairExternalAccess = (school: string, repair: string, grant: string, body: FacilitiesCommand & { note: string }) => post(`${root(school, repair)}/${encodeURIComponent(grant)}/end`, body);
