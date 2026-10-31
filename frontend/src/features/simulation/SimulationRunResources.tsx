import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileCheck2, RefreshCw, SendToBack } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { focusSimulationHeading } from "./simulationFocus";
import {
  getSimulationRunResources,
  type SimulationExecutionEffectKind,
  type SimulationRunStatus,
} from "./simulationApi";

const EFFECT_PAGE_SIZE = 5;

const EFFECT_LABELS: Record<SimulationExecutionEffectKind, string> = {
  operational_message: "Operational message",
  external_notification: "External notification",
  connector_call: "Connector call",
  file_write: "File write",
  external_compute_call: "External compute call",
  webhook_delivery: "Webhook delivery",
  realtime_publication: "Realtime publication",
};

function requestedPage(value: string | null) {
  const page = Number(value ?? "1");
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

interface SimulationRunResourcesProps {
  runId: string;
  runStatus: SimulationRunStatus;
  schoolId: string;
}

export function SimulationRunResources({ runId, runStatus, schoolId }: SimulationRunResourcesProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const page = requestedPage(searchParams.get("effectsPage"));
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousPage = useRef(page);
  const resourcesQuery = useQuery({
    queryKey: ["simulation-run-resources", schoolId, runId, page],
    queryFn: ({ signal }) => getSimulationRunResources(schoolId, runId, page, EFFECT_PAGE_SIZE, signal),
    retry: false,
    refetchInterval: runStatus === "running" ? 5_000 : false,
  });
  const resources = resourcesQuery.data;
  const totalPages = resources ? Math.max(1, Math.ceil(resources.effects.total / resources.effects.page_size)) : page;
  const currentPage = resources ? Math.min(resources.effects.page, totalPages) : page;

  useEffect(() => {
    if (!resources) return;
    const canonicalPage = Math.min(page, totalPages);
    if (canonicalPage === page && searchParams.get("effectsPage") === (canonicalPage === 1 ? null : String(canonicalPage))) return;
    const nextParams = new URLSearchParams(searchParams);
    if (canonicalPage === 1) nextParams.delete("effectsPage");
    else nextParams.set("effectsPage", String(canonicalPage));
    setSearchParams(nextParams, { replace: true });
  }, [page, resources, searchParams, setSearchParams, totalPages]);

  useLayoutEffect(() => {
    if (previousPage.current === currentPage) return;
    previousPage.current = currentPage;
    focusSimulationHeading(headingRef.current);
  }, [currentPage]);

  const recordedAt = useMemo(() => new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }), []);

  const changePage = (nextPage: number) => {
    const boundedPage = Math.max(1, Math.min(totalPages, nextPage));
    const nextParams = new URLSearchParams(searchParams);
    if (boundedPage === 1) nextParams.delete("effectsPage");
    else nextParams.set("effectsPage", String(boundedPage));
    setSearchParams(nextParams);
  };

  return (
    <section className="simulation-resources" aria-labelledby="simulation-effects-title">
      <header className="simulation-section-heading">
        <div>
          <p className="simulation-workspace__eyebrow">Contained effects</p>
          <h3 id="simulation-effects-title" ref={headingRef} tabIndex={-1}>External-effect evidence</h3>
          <p>These actions were captured inside this run. Nothing listed here was delivered to a Live recipient, credential, device, file store or network.</p>
        </div>
      </header>

      {resourcesQuery.isPending ? (
        <div className="simulation-resources__state" aria-busy="true">Loading contained-effect evidence…</div>
      ) : resourcesQuery.isError || !resources ? (
        <div className="simulation-resources__state is-error" role="alert">
          <span>Effect evidence could not be loaded. Live data was not used as a fallback.</span>
          <button type="button" onClick={() => void resourcesQuery.refetch()}><RefreshCw size={15} aria-hidden="true" /> Retry</button>
        </div>
      ) : (
        <>
          <dl className="simulation-resources__counts">
            <div><dt>Effects captured</dt><dd>{resources.effects.total}</dd></div>
            <div><dt>Artifacts retained</dt><dd>{resources.counts.artifacts}</dd></div>
            <div><dt>Artifact storage</dt><dd>{formatBytes(resources.counts.artifact_bytes)}</dd></div>
          </dl>

          {resources.effects.results.length > 0 ? (
            <ol className="simulation-resources__list">
              {resources.effects.results.map((effect) => (
                <li key={effect.id}>
                  <span className="simulation-resources__icon" aria-hidden="true">
                    {effect.kind === "file_write" ? <FileCheck2 size={17} /> : <SendToBack size={17} />}
                  </span>
                  <div>
                    <strong>{EFFECT_LABELS[effect.kind]}</strong>
                    <span>{effect.schema_name.replaceAll("_", " ")} · {effect.logical_target.kind.replaceAll("_", " ")}</span>
                    <small>{recordedAt.format(new Date(effect.recorded_at))} · Evidence {effect.payload_digest.slice(0, 12)}…</small>
                  </div>
                  <span className="simulation-resources__status">Captured</span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="simulation-resources__empty">
              <SendToBack size={20} aria-hidden="true" />
              <div><strong>No external effects captured yet</strong><p>This run has not attempted a modeled message, connector, file or network action.</p></div>
            </div>
          )}

          {totalPages > 1 ? (
            <nav className="simulation-pagination" aria-label="External-effect evidence pages">
              <button type="button" disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}><ArrowLeft size={15} aria-hidden="true" /> Previous</button>
              <span aria-live="polite">Page {currentPage} of {totalPages}</span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => changePage(currentPage + 1)}>Next <ArrowRight size={15} aria-hidden="true" /></button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
