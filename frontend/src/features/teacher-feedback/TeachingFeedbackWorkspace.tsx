import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import type { WorkspaceManifest, WorkspaceMoreItem, WorkspaceScope } from "../workspace/types";
import { CreateFeedback } from "./CreateFeedback";
import { FeedbackResults } from "./FeedbackResults";
import { RespondFeedback } from "./RespondFeedback";
import { closeCampaign, getPending, getWorkspace } from "./api";
import "./teacher-feedback.css";

export const feedbackCoordinateCapability = "teacher_feedback.coordinate";
export const feedbackRespondCapability = "teacher_feedback.respond";

export interface FeedbackWorkspaceAccess {
  readonly canCoordinate: boolean;
  readonly canRespond: boolean;
  readonly responseScopes: readonly WorkspaceScope[];
}

/**
 * The server manifest is the composition boundary. This deliberately does not
 * inspect account roles or ask the person to choose a portal/persona.
 */
export function feedbackWorkspaceAccess(item: WorkspaceMoreItem): FeedbackWorkspaceAccess {
  const capabilities = item.capabilities ?? [];
  return {
    canCoordinate: capabilities.includes(feedbackCoordinateCapability),
    canRespond: capabilities.includes(feedbackRespondCapability),
    responseScopes: (item.scopes ?? []).filter((scope) => scope.kind === "self" || scope.kind === "dependent"),
  };
}

function environmentKey(manifest: WorkspaceManifest): string {
  return manifest.context.environment.namespace_id
    ?? `${manifest.context.environment.kind}:${manifest.context.institution_id}`;
}

function ResponseContext({ scopes }: { scopes: readonly WorkspaceScope[] }) {
  if (!scopes.length) return null;
  if (scopes.length === 1) return <p className="teacher-feedback__context">
    <strong>{scopes[0]?.kind === "self" ? "My learning" : scopes[0]?.label ?? "Linked learner"}</strong>
    <span>Only check-ins currently available through this relationship are shown.</span>
  </p>;
  return <p className="teacher-feedback__context">
    <strong>{scopes.length} learner relationships</strong>
    <span>ThatCampus shows only the check-ins your current relationships allow you to answer.</span>
  </p>;
}

export function FeedbackCoordinationSurface({ manifest }: { manifest: WorkspaceManifest }) {
  const school = manifest.context.institution_id;
  const execution = environmentKey(manifest);
  const client = useQueryClient();
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["teacher-feedback", "workspace", execution, school],
    queryFn: () => getWorkspace(school),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(() => params.get("campaign") ?? "");
  const [closing, setClosing] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function close(id: string) {
    setBusy(true);
    setError("");
    try {
      await closeCampaign(school, id);
      setClosing("");
      await client.invalidateQueries({ queryKey: ["teacher-feedback"] });
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return <section className="teacher-feedback" aria-labelledby="feedback-coordinate-title">
    <header className="teacher-feedback__heading">
      <div>
        <h2 id="feedback-coordinate-title">Coordinate teaching check-ins</h2>
        <p>Ask a class what is working, collect protected responses and review only released group results.</p>
      </div>
      <button className="teacher-feedback__primary" disabled={!query.data || creating} onClick={() => setCreating(true)}>Ask for feedback</button>
    </header>
    {query.isPending ? <p role="status">Loading feedback requests…</p> : query.error ? <div role="alert">
      <p>{query.error.message}</p><button onClick={() => void query.refetch()}>Try again</button>
    </div> : query.data ? <>
      {creating ? <CreateFeedback school={school} data={query.data} onCancel={() => setCreating(false)} onCreated={async () => {
        setCreating(false);
        await query.refetch();
      }} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!query.data.campaigns.length ? <section className="teacher-feedback__card">
        <ProductIcon name="feedback" size={36} />
        <h2>No feedback requests yet</h2>
        <p>Start with a few focused parameters. Students or guardians can respond in under a minute.</p>
      </section> : query.data.campaigns.map((campaign) => <section className="teacher-feedback__card" key={campaign.id}>
        <div className="teacher-feedback__result-heading">
          <div><h2>{campaign.title}</h2><p>{campaign.teacher_name} · Class {campaign.class_name} · {campaign.audience}</p></div>
          <span className="teacher-feedback__status">{campaign.is_closed ? "Closed" : "Open"}</span>
        </div>
        <p>{campaign.response_count} {campaign.response_count === 1 ? "response" : "responses"} · Closes {new Date(campaign.closes_at).toLocaleString()}</p>
        <div className="teacher-feedback__actions">
          <button aria-expanded={selected === campaign.id} aria-controls={`feedback-results-${campaign.id}`} onClick={() => setSelected(selected === campaign.id ? "" : campaign.id)}>{selected === campaign.id ? "Hide results" : "View results"}</button>
          {!campaign.is_closed ? <button onClick={() => setClosing(campaign.id)}>Close request</button> : null}
        </div>
        {closing === campaign.id ? <div className="teacher-feedback__confirm">
          <p>Close this request now? New responses will stop and it cannot be reopened.</p>
          <button disabled={busy} onClick={() => void close(campaign.id)}>{busy ? "Closing…" : "Yes, close request"}</button>
          <button disabled={busy} onClick={() => setClosing("")}>Keep open</button>
        </div> : null}
        {selected === campaign.id ? <FeedbackResults school={school} id={campaign.id} /> : null}
      </section>)}
    </> : null}
  </section>;
}

export function FeedbackResponseSurface({ manifest, scopes }: {
  manifest: WorkspaceManifest;
  scopes: readonly WorkspaceScope[];
}) {
  const school = manifest.context.institution_id;
  const execution = environmentKey(manifest);
  const [params] = useSearchParams();
  const focusCampaignId = params.get("campaign");
  const query = useQuery({
    queryKey: ["teacher-feedback", "pending", execution, school],
    queryFn: () => getPending(school),
    refetchInterval: 30_000,
    refetchOnMount: "always",
  });
  const campaigns = query.data?.campaigns ?? [];
  const focusUnavailable = Boolean(focusCampaignId && query.isSuccess && !campaigns.some((campaign) => campaign.id === focusCampaignId));

  return <section className="teacher-feedback" aria-labelledby="feedback-response-title">
    <header><h2 id="feedback-response-title">Teaching check-ins for me</h2><p>Your experience can help improve teaching. ThatCampus shows only requests you are currently allowed to answer.</p></header>
    <ResponseContext scopes={scopes} />
    {focusUnavailable ? <p className="teacher-feedback__status" role="alert">This feedback request is no longer open for your current relationship.</p> : null}
    {query.isPending ? <p role="status">Loading your feedback requests…</p> : query.error ? <div role="alert">
      <p>{query.error.message}</p><button onClick={() => void query.refetch()}>Try again</button>
    </div> : campaigns.length ? campaigns.map((campaign) => <RespondFeedback
      key={campaign.id}
      school={school}
      campaign={campaign}
      focused={campaign.id === focusCampaignId}
      onSubmitted={async () => { await query.refetch(); }}
    />) : <section className="teacher-feedback__card"><ProductIcon name="feedback" size={36} /><h2>You're all caught up</h2><p>When a teaching check-in is available to you, it will appear here.</p></section>}
  </section>;
}

export function TeachingFeedbackWorkspace({ manifest, item }: {
  manifest: WorkspaceManifest;
  item: WorkspaceMoreItem;
}) {
  const [params, setParams] = useSearchParams();
  const access = useMemo(() => feedbackWorkspaceAccess(item), [item]);
  const requestedView = params.get("view");
  const relationshipLink = params.get("scope") === "self" || params.get("scope") === "dependent" || params.has("student_id");
  const view = requestedView === "respond" && access.canRespond
    ? "respond"
    : requestedView === "coordinate" && access.canCoordinate
      ? "coordinate"
      : relationshipLink && access.canRespond
        ? "respond"
        : access.canCoordinate
          ? "coordinate"
          : "respond";

  function select(next: "coordinate" | "respond") {
    const updated = new URLSearchParams(params);
    updated.set("view", next);
    setParams(updated, { replace: true });
  }

  if (!access.canCoordinate && !access.canRespond) return <section className="more-workspace-empty" role="status">
    <h2>Teaching feedback is unavailable</h2>
    <p>Your current responsibilities and learner relationships do not contribute a feedback action.</p>
  </section>;

  return <div className="more-workspace-feedback">
    {access.canCoordinate && access.canRespond ? <div className="more-workspace-segmented" role="tablist" aria-label="Teaching feedback workspace">
      <button type="button" role="tab" id="feedback-coordinate-tab" aria-controls="feedback-coordinate-panel" aria-selected={view === "coordinate"} onClick={() => select("coordinate")}>Coordinate</button>
      <button type="button" role="tab" id="feedback-respond-tab" aria-controls="feedback-respond-panel" aria-selected={view === "respond"} onClick={() => select("respond")}>Respond</button>
    </div> : null}
    <div
      id={view === "coordinate" ? "feedback-coordinate-panel" : "feedback-respond-panel"}
      role={access.canCoordinate && access.canRespond ? "tabpanel" : undefined}
      aria-labelledby={access.canCoordinate && access.canRespond ? `feedback-${view}-tab` : undefined}
    >
      {view === "coordinate"
        ? <FeedbackCoordinationSurface manifest={manifest} />
        : <FeedbackResponseSurface manifest={manifest} scopes={access.responseScopes} />}
    </div>
  </div>;
}
