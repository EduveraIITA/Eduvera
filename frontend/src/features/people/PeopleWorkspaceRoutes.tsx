import { WorkspaceAreaRoutePage } from "../workspace/WorkspaceAreaRoutePage";

/**
 * Compatibility export for callers that have not yet moved to the generic Area
 * resolver. People eligibility and discoverability come exclusively from the
 * server-composed workspace manifest; this component must never infer a portal,
 * membership role or permission bundle in the browser.
 */
export function WorkspacePeopleRoute() {
  return <WorkspaceAreaRoutePage areaKey="people" />;
}

export { WorkspacePeopleRecordsRoute } from "./PeoplePage";
export { WorkspacePeopleImportRoute } from "./PeopleImportPage";
