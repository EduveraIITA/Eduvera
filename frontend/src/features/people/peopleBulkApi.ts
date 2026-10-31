import { apiFetch } from "../../lib/api";
export interface PeopleNameMatch { id: string; label: string; revision: number; affiliations: string[] }
export interface PeopleNameCheck { row_id: string; name: string; normalized_name: string; matches: PeopleNameMatch[]; total: number; truncated: boolean }
export const checkPeopleImportNames = (schoolId: string, names: Array<{ row_id: string; name: string }>) => apiFetch<{ results: PeopleNameCheck[] }>(`/api/v1/schools/${encodeURIComponent(schoolId)}/people/participants/name-check`, { method: "POST", body: JSON.stringify({ names }) });
