import CampusViewPage from "../../features/campus-view/CampusViewPage";
import type { CampusTruthDimension, CampusViewOverlay } from "../../features/campus-view/types";
import { useCampusLabProjection } from "./CampusLabProjectionContext";

function dimension(state: "expected" | "recorded" | "issue"): CampusTruthDimension {
  if (state === "recorded") return "accepted";
  if (state === "expected") return "expected";
  return "unknown";
}

export function campusLabViewOverlay(status: ReturnType<typeof useCampusLabProjection>["status"], isError = false): CampusViewOverlay | null {
  if (!status) return isError ? { status: "offline", badge_label: "Simulation offline", zones: [], activity: [] } : null;
  const paused = status.status === "paused";
  return {
    status: status.status,
    badge_label: paused ? status.phase?.label || "Simulation paused" : "Simulated",
    generated_at: status.generated_at,
    next_change_at: status.phase?.next_change_at ?? undefined,
    zones: paused ? [] : status.zones.flatMap((zone) => zone.space_id ? [{
      space_id: zone.space_id,
      title: zone.subject || zone.class_name || zone.activity,
      count: zone.actors.length,
      state_dimension: "expected" as const,
      marker_label: "Expected · simulation",
      source_label: "Simulated school day",
      source_detail: `${zone.actors.length} dummy ${zone.actors.length === 1 ? "person is" : "people are"} expected here. This is not a sensor observation.`,
      explanation: "The development routine currently expects these dummy people in this space. This rehearsal projection is kept separate from sensor and accepted campus evidence.",
      people_heading: "Simulated people",
      people_more_label: `+ ${Math.max(0, zone.actors.length - 8)} more simulated people`,
      people: zone.actors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        avatar_url: actor.avatar_url,
        descriptor: actor.class_name || (actor.role === "student" ? "Student" : "Staff"),
      })),
    }] : []),
    activity: status.activity.map((item) => ({
      id: `synthetic:${item.id}`,
      occurred_at: item.occurred_at,
      title: item.title,
      detail: item.detail,
      state_dimension: dimension(item.state),
      source_label: "Simulated school day",
      target_path: item.target_path,
    })),
  };
}

export default function CampusViewDevelopmentPage() {
  const projection = useCampusLabProjection();
  const overlay = campusLabViewOverlay(projection.status, projection.isError);
  return <CampusViewPage overlay={overlay} />;
}
