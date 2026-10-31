import { ArrowRight, Building2, CalendarDays, Settings2, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import { useExecutionEnvironment } from "./ExecutionEnvironmentContext";

/** Editor discovery uses the same selected-world responsibility catalogue as Areas. */
export function ScenarioEditorLinks() {
  const environment = useExecutionEnvironment();
  const workspace = useWorkspaceManifest();
  if (workspace.isPending) return <p role="status">Finding the editors available in this scenario…</p>;
  if (workspace.isError || !workspace.data || !manifestMatchesEnvironment(workspace.data, environment)) {
    return <div role="alert"><p>We couldn’t confirm your scenario editors. Refresh to check current access.</p><button type="button" className="simulation-button" onClick={() => void workspace.refetch()}>Refresh editors</button></div>;
  }
  const manifest = workspace.data;
  const surfaces = manifest.areas.flatMap((area) => area.surfaces);
  const hasSurface = (href: string) => surfaces.some((surface) => surface.href === href);
  const setup = (key: string) => manifest.more.setup.find((item) => item.key === key)?.href;
  const capabilities = setup("capabilities");
  const institution = setup("institution");
  const editors = [
    {
      label: "Timetable", icon: CalendarDays,
      to: hasSurface("/areas/timetable/planning") ? "/areas/timetable/planning" : capabilities ? `${capabilities}?task=timetable` : null,
      detail: hasSurface("/areas/timetable/planning") ? "Change activities, participants, times and places" : "Review timetable prerequisites and planning responsibility",
    },
    {
      label: "People", icon: Users,
      to: hasSurface("/areas/people/participants") ? "/areas/people/participants" : hasSurface("/areas/people/records") ? "/areas/people/records" : setup("people") ?? null,
      detail: hasSurface("/areas/people/participants") ? "Change campus people and mixed participation groups" : hasSurface("/areas/people/records") ? "Review people and their campus records" : "Review people setup and account access",
    },
    {
      label: "Staff availability", icon: ShieldCheck,
      to: hasSurface("/areas/responsibilities/leave") ? "/areas/responsibilities/leave" : setup("responsibilities") ?? null,
      detail: hasSurface("/areas/responsibilities/leave") ? "Model leave, availability and resulting coverage" : "Assign staff responsibilities before modelling leave and cover",
    },
    { label: "Spaces", icon: Building2, to: institution ? `${institution}/campus` : null, detail: "Change campuses, rooms and placements" },
    { label: "Operating rules", icon: Settings2, to: institution ? `${institution}/operating-rules` : null, detail: "Change automatic behaviour inside this scenario" },
  ];
  return <nav className="simulation-editor-links" aria-label="Scenario editors">
    {editors.map(({ label, icon: Icon, to, detail }) => to ? <Link key={label} to={to}>
      <Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>{detail}</small></span><ArrowRight size={17} aria-hidden="true" />
    </Link> : <div key={label} className="simulation-editor-links__unavailable">
      <Icon size={19} aria-hidden="true" /><span><strong>{label}</strong><small>This editor requires an effective responsibility in the captured campus.</small></span>
    </div>)}
  </nav>;
}
