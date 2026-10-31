import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CampusSpaceEditor, type CampusSpaceDefaults } from "../office/CampusSpaceEditor";
import { getInstitutionSetup, type CampusSpace } from "../office/api";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { LIVE_EXECUTION_ENVIRONMENT } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import type { CampusSceneDocument, CampusSceneElement, CampusSceneSpace } from "./types";

function suggestedKind(element: CampusSceneElement): CampusSpace["kind"] {
  if (element.asset_key === "gate") return "gate";
  if (element.kind === "room") return "classroom";
  return element.kind === "building" ? "building" : "other";
}
export function CampusScenePlaceCreator({ schoolId, campusId, element, scene, onClose, onCreated }: {
  schoolId: string; campusId: string; worldKey: string; element: CampusSceneElement; scene: CampusSceneDocument;
  onClose: () => void; onCreated: (space: CampusSceneSpace) => void;
}) {
  const environment = useOptionalExecutionEnvironment() ?? LIVE_EXECUTION_ENVIRONMENT;
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: executionEnvironmentQueryKey(environment, ["institution-setup", schoolId]), queryFn: () => getInstitutionSetup(schoolId), retry: false, staleTime: 0 });
  const data = query.data;
  if (query.isPending || !data || query.isError) return <PlannerDialog title="Add campus place" onClose={onClose}><div className="campus-scene-fields">{query.isError ? <><p className="campus-scene-error" role="alert">Campus places could not be loaded. Your drawing is unchanged.</p><button type="button" className="campus-scene-button" onClick={() => void query.refetch()}>Try again</button></> : <p role="status">Loading campus places…</p>}<button type="button" className="campus-scene-button" onClick={onClose}>Cancel</button></div></PlannerDialog>;
  if (!data.campuses.some(campus => campus.id === campusId && campus.status === "active")) return <PlannerDialog title="Campus unavailable" onClose={onClose}><p>This campus is not available in the current workspace. Return to the guide and choose an active campus.</p><button type="button" onClick={onClose}>Return to drawing</button></PlannerDialog>;
  const currentSpace = element.space_id ? data.spaces.find(space => space.id === element.space_id && space.campus_id === campusId) : undefined;
  if (element.space_id && !currentSpace) return <PlannerDialog title="Place unavailable" onClose={onClose}><p>This linked place is unavailable in the current campus. Choose a current place in the drawing, or clear the link before creating a different place.</p><button type="button" onClick={onClose}>Return to drawing</button></PlannerDialog>;
  const parentElement = scene.elements.find(item => item.id === element.parent_element_id);
  const parentId = element.floor_id ?? parentElement?.space_id;
  const parent = data.spaces.find(space => space.id === parentId && space.campus_id === campusId && space.status === "active" && (space.kind === "floor" || space.kind === "building"));
  const defaults: CampusSpaceDefaults = { name: element.label, kind: suggestedKind(element), parent_space_id: parent?.id ?? null };
  return <CampusSpaceEditor schoolId={schoolId} campusId={campusId} fixedCampus data={data} space={currentSpace} defaults={defaults} onClose={onClose} onSaved={space => {
    if (space.campus_id !== campusId) throw new Error("This place belongs to another campus. Refresh the campus places before linking it.");
    queryClient.setQueryData<typeof data>(executionEnvironmentQueryKey(environment, ["institution-setup", schoolId]), current => current ? { ...current, spaces: [...current.spaces.filter(item => item.id !== space.id), space] } : current);
    onCreated(space);
  }} />;
}
