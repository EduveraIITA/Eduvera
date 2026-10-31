import { useNavigate } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ResponsibilityWorkspace } from "./ResponsibilityWorkspace";
import type { WorkspaceView } from "./types";

const routeByView: Record<WorkspaceView, string> = {
  today: "/today",
  work: "/work",
  areas: "/areas",
  more: "/more",
};

/**
 * URL-addressable boundary for the single responsibility-composed shell.
 * It selects a projection only; domain actions stay in their owning Areas.
 */
export function WorkspaceRoutePage({ view }: { readonly view: WorkspaceView }) {
  const navigate = useNavigate();
  return <OperationsShell active={view} title={view === "more" ? "More" : view[0]!.toUpperCase() + view.slice(1)}>
    <ResponsibilityWorkspace
      activeView={view}
      showNavigation={false}
      showPageHeading={false}
      onViewChange={(next) => navigate(routeByView[next])}
    />
  </OperationsShell>;
}
