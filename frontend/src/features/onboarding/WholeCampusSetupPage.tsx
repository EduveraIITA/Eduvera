import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ApiError } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { getCampusSceneDirectory, getCampusSceneWorkspace } from "../campus-scenes/api";
import { sceneOnboardingReadiness } from "../campus-scenes/sceneSetupReadiness";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { WholeCampusGuideStage, type WholeCampusGuideStep } from "./WholeCampusGuideStage";
import "./whole-campus-setup.css";

const steps = [
  { key: "find", title: "Our campus" },
  { key: "layout", title: "Our layout" },
  { key: "connect", title: "Useful places" },
  { key: "share", title: "Try and share" },
] as const;

export function wholeCampusGuideHref(campusId?: string, step: WholeCampusGuideStep = "find") {
  const params = new URLSearchParams({ step });
  if (campusId) params.set("campus_id", campusId);
  return `/more/setup/whole-campus?${params}`;
}

function GuideRecovery({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const revoked = error instanceof ApiError && error.status === 403;
  return <section className="whole-campus-guide__state" role="alert">
    <h2>{revoked ? "Campus setup access has changed" : "Your campus guide couldn’t load"}</h2>
    <p>{revoked ? "Your current responsibilities no longer allow this setup. Saved campus records stay with their owners." : "Your saved layout is safe. Try again to read the current campus before continuing."}</p>
    <button className="whole-campus-guide__secondary" type="button" onClick={onRetry}><RefreshCw size={17} aria-hidden="true" />Try again</button>
  </section>;
}

export default function WholeCampusSetupPage() {
  const auth = useAuth();
  const environment = useExecutionEnvironment();
  const [params, setParams] = useSearchParams();
  const schoolId = auth.user?.active_school_id ?? "";
  const membership = auth.memberships.find(member => member.school_id === schoolId);
  const worldKey = executionEnvironmentIdentity(environment);
  const unavailable = environment.mode === "simulation" && environment.unavailable === true;
  const institutionMismatch = Boolean(environment.institutionId && environment.institutionId !== schoolId);
  const allowed = Boolean(schoolId && membership?.role === "admin" && !unavailable && !institutionMismatch);
  const key = unavailable ? ["whole-campus-guide-unavailable", worldKey] : executionEnvironmentQueryKey(environment,
    ["whole-campus-guide", worldKey, schoolId, auth.user?.id, environment.mode === "simulation" && !environment.unavailable ? environment.worldRevision ?? 0 : 0]);
  const directory = useQuery({ queryKey: [...key, "directory"], queryFn: ({ signal }) => getCampusSceneDirectory(schoolId, signal), enabled: allowed, retry: false, staleTime: 0 });
  const requestedCampus = params.get("campus_id");
  const selected = requestedCampus ? directory.data?.campuses.find(campus => campus.id === requestedCampus)
    : directory.data?.campuses.find(campus => campus.is_primary) ?? directory.data?.campuses[0];
  const workspace = useQuery({ queryKey: [...key, selected?.id, "workspace"], queryFn: ({ signal }) => getCampusSceneWorkspace(schoolId, selected!.id, signal),
    enabled: allowed && Boolean(selected) && directory.data?.can_edit === true && !directory.isError, retry: false, staleTime: 0 });
  const document = workspace.data?.scene?.draft ?? workspace.data?.scene?.published?.document ?? null;
  const readiness = useMemo(() => document ? sceneOnboardingReadiness(document, workspace.data?.spaces ?? []) : null, [document, workspace.data?.spaces]);
  const workspaceMismatch = Boolean(selected && workspace.data && workspace.data.campus.id !== selected.id);
  const requestedStep = params.get("step");
  const defaultStep = !selected ? "find" : !document?.elements.length ? "layout" : !readiness?.counts.linkedPlaces ? "connect" : "share";
  const step = (steps.some(item => item.key === requestedStep) ? requestedStep : defaultStep) as WholeCampusGuideStep;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [step, selected?.id, worldKey]);
  function chooseStep(value: WholeCampusGuideStep) {
    const next = new URLSearchParams({ step: value });
    if (selected) next.set("campus_id", selected.id);
    setParams(next);
  }
  const loading = directory.isPending || Boolean(selected && directory.data?.can_edit && workspace.isPending);
  const error = directory.error ?? workspace.error;
  const campusSetupHref = `/more/setup/institution/campus?${new URLSearchParams({ setup: "whole-campus", setup_step: step, ...(selected ? { campus_id: selected.id } : {}) })}`;
  return <OperationsShell active="more" title="Build your campus" backTo="/more/setup" schoolName={membership?.school_name} contentHasHeading>
    <div className="whole-campus-guide" key={`${worldKey}:${schoolId}:${auth.user?.id}`}>
      <header className="whole-campus-guide__intro"><p className="whole-campus-guide__eyebrow">Start small. Add more as you go.</p><h1 ref={heading} tabIndex={-1}>Bring your campus to life.</h1><p>Start with a place people recognise. Build its view, connect useful places and grow from there.</p></header>
      {unavailable || institutionMismatch ? <section className="whole-campus-guide__state" role="alert"><h2>{unavailable ? "This Simulation is unavailable" : "Your campus context has changed"}</h2><p>Recover the selected campus before continuing. No Live campus will be used in its place.</p><Link className="whole-campus-guide__secondary" to={unavailable ? "/more/simulation" : "/more"}>Open {unavailable ? "Simulation controls" : "your workspace"}<ArrowRight size={18} aria-hidden="true" /></Link></section>
        : !allowed ? <section className="whole-campus-guide__state"><h2>Campus setup isn’t assigned to you</h2><p>Ask your campus administrator to continue setup. You can keep using the tools available through your responsibilities.</p><Link className="whole-campus-guide__secondary" to="/more">Return to your workspace</Link></section>
        : loading ? <div className="whole-campus-guide__state" role="status"><div className="whole-campus-guide__skeleton" /><p>Finding your saved campus and next useful step…</p></div>
        : error || workspaceMismatch ? <GuideRecovery error={error ?? new Error("The saved layout belongs to another campus.")} onRetry={() => { void directory.refetch(); if (selected) void workspace.refetch(); }} />
        : directory.data?.can_edit !== true ? <section className="whole-campus-guide__state" role="alert"><h2>Campus setup access has changed</h2><p>Refresh your responsibilities before continuing.</p><button type="button" className="whole-campus-guide__secondary" onClick={() => void directory.refetch()}>Check access again</button></section>
        : <>
          {directory.data.campuses.length > 1 || requestedCampus && !selected ? <label className="whole-campus-guide__campus">Campus<select value={selected?.id ?? ""} onChange={event => setParams({ campus_id: event.target.value, step: "find" })}><option value="" disabled>Choose an available campus</option>{directory.data.campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label> : selected ? <p className="whole-campus-guide__campus-name">{selected.name}</p> : null}
          {requestedCampus && !selected ? <section className="whole-campus-guide__state" role="alert"><h2>This campus is unavailable</h2><p>Choose a current campus above. Your other campus records have not been changed.</p></section> : <>
            <nav className="whole-campus-guide__steps" aria-label="Campus building steps">{steps.map((item, index) => <button type="button" key={item.key} aria-current={step === item.key ? "step" : undefined} onClick={() => chooseStep(item.key)}><span aria-hidden="true">{index + 1}</span><strong>{item.title}</strong></button>)}</nav>
            <WholeCampusGuideStage key={`${worldKey}:${selected?.id}:${step}`} step={step} schoolId={schoolId} campus={selected ?? null} workspace={workspace.data ?? null} readiness={readiness} campusSetupHref={campusSetupHref} onStep={chooseStep} />
            <p className="whole-campus-guide__pause"><Link to="/more/setup">Finish later</Link><span>Saved places and drafts stay here. Return through Campus setup.</span></p>
          </>}
        </>}
    </div>
  </OperationsShell>;
}
