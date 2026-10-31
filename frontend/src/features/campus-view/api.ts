import { apiFetch } from "../../lib/api";
import { normalizeCampusView, type RawCampusViewResponse } from "../../../../packages/contracts/src/campus-view-normalize";
export { activityTruthDimension } from "../../../../packages/contracts/src/campus-view-normalize";

export async function getCampusView(schoolId: string, campusId?: string, signal?: AbortSignal) {
  const query = new URLSearchParams();
  if (campusId) query.set("campus_id", campusId);
  const suffix = query.size ? `?${query.toString()}` : "";
  const data = await apiFetch<RawCampusViewResponse>(`/api/v1/schools/${encodeURIComponent(schoolId)}/campus-view/${suffix}`, { signal });
  return normalizeCampusView(data);
}
