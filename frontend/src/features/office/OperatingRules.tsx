import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { getStaffWorkspace } from "../staff-operations/api";
import { CoverageOperatingRules } from "./CoverageOperatingRules";
import { WorkflowRules } from "./WorkflowRules";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { CategoryOperatingRules } from "./CategoryOperatingRules";

export function OperatingRules({ schoolId }: { schoolId: string }) {
  const [params] = useSearchParams();
  const rule = params.get("rule");
  const [dirtySections, setDirtySections] = useState<Record<string, boolean>>({});
  const editorKey = `${schoolId}:${rule ?? "index"}`;
  const dirty = Object.entries(dirtySections).some(([section, value]) => section.startsWith(`${editorKey}:`) && value);
  const setSectionDirty = useCallback((section: string, value: boolean) => {
    const key = `${editorKey}:${section}`;
    setDirtySections((current) => current[key] === value ? current : { ...current, [key]: value });
  }, [editorKey]);
  useUnsavedChangesGuard(dirty, "Discard your unsaved operating-rule changes?");
  const base = `?school=${encodeURIComponent(schoolId)}&section=rules`;
  const categories = [
    ["attendance", "Attendance", "Academic registers, campus presence and capture methods"],
    ["events", "Event attendance", "Observation windows for every event register"],
    ["coverage", "Leave cover", "Deadlines and automatic fallback decisions"],
    ["departure", "Departure & transport", "Allowed arrangements, cutoff and location handling"],
    ["messages", "Messaging", "Who can message, communication hours and retention"],
  ];
  if (!categories.some(([id]) => id === rule)) return <>
    <p className="office-hint">How the app operates across your institution.</p>
    <nav className="more-grid more-grid--list" aria-label="Operating rule categories">{categories.map(([id, title]) => <Link className="more-tile more-tile--text-only" key={id} to={`${base}&rule=${id}`}><span className="more-tile__copy"><strong>{title}</strong></span><ChevronRight className="more-tile__chevron" size={18} aria-hidden="true"/></Link>)}</nav>
  </>;
  return <>
    {rule === "attendance" ? <WorkflowRules schoolId={schoolId} category="attendance" onDirtyChange={(value) => setSectionDirty("workflow", value)}/> : rule === "coverage" ? <CoverageRules schoolId={schoolId} onDirtyChange={(value) => setSectionDirty("coverage", value)}/> : <CategoryOperatingRules schoolId={schoolId} category={rule as "events" | "departure" | "messages"} onDirtyChange={(value) => setSectionDirty("category", value)}/>}
  </>;
}
function CoverageRules({ schoolId, onDirtyChange }: { schoolId: string; onDirtyChange: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["operating-rules", schoolId, "coverage"], queryFn: () => getStaffWorkspace(schoolId) });
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  if (query.data.mode !== "admin") return <p role="alert">Administrator access is required.</p>;
  return <CoverageOperatingRules key={query.data.coverage_policy?.revision ?? 0} schoolId={schoolId} data={query.data} onDirtyChange={onDirtyChange} refresh={async () => { await query.refetch(); await client.invalidateQueries(); }}/>;
}
