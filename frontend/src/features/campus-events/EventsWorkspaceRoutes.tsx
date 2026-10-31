import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { useOptionalAuth } from "../auth/AuthContext";
import { useExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { manifestMatchesEnvironment } from "../workspace/ResponsibilityWorkspace";
import { WorkspaceState } from "../workspace/WorkspaceState";
import type { WorkspaceArea, WorkspaceAreaSurface, WorkspaceManifest } from "../workspace/types";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";
import {
  cancelCampusEvent,
  changeEventRegisterLock,
  createCampusEvent,
  getCampusEvent,
  getCampusEventCatalog,
  getCampusEventFinance,
  getCampusEvents,
  getEventRegister,
  getEventRegisterHistory,
  recordCampusEventConsent,
  recordCampusEventRefund,
  respondToCampusEvent,
  saveCampusEvent,
  saveEventRegister,
  transitionCampusEvent,
  updateCampusEventChecklist,
  withdrawFromPaidCampusEvent,
} from "./api";
import { ClassTestEditorPage } from "./ClassTestEditorPage";
import { EventEditorPage } from "./EventEditorPage";
import { EventRegisterPage } from "./EventRegisterPage";
import {
  FamilyEventDetailPage,
  FamilyEventListPage,
  readFamilyEventActionFocus,
  type RelationshipEventWorkspace,
} from "./FamilyEventPages";
import {
  eventWorkspaceDetailHref,
  eventWorkspaceListHref,
} from "./eventNavigation";
import {
  OperationsEventAttentionGate,
  type OperationsEventAttentionTarget,
} from "./EventAttentionGate";
import { OperationsEventDetailPage } from "./OperationsEventDetailPage";
import { OperationsEventListPage, type EventView } from "./OperationsEventListPage";
import type { CampusEventInput } from "./types";

type OperationsSurface = "manage" | "assigned";
type RelationshipKind = "self" | "dependent";
type RequestedSurface = OperationsSurface | "calendar";

export interface EventsWorkspaceAccess {
  manifest: WorkspaceManifest;
  area: WorkspaceArea;
  surface: WorkspaceAreaSurface;
  schoolId: string;
  basePath: string;
  operationsKind?: OperationsSurface;
  relationship?: RelationshipKind;
  studentId?: string;
  relationshipLabel?: string | null;
}

/** Pure resolver used by routes and tests. It never infers a portal or job title. */
export function resolveEventsWorkspaceAccess(
  manifest: WorkspaceManifest,
  requested: RequestedSurface,
  search: URLSearchParams,
): EventsWorkspaceAccess | null {
  const area = manifest.areas.find((entry) => entry.key === "events");
  if (!area) return null;
  if (requested === "manage" || requested === "assigned") {
    const surface = area.surfaces.find((entry) => entry.key === requested);
    if (!surface) return null;
    return {
      manifest,
      area,
      surface,
      schoolId: manifest.context.institution_id,
      basePath: `/areas/events/${requested}`,
      operationsKind: requested,
    };
  }
  const relationship = search.get("scope");
  const studentId = search.get("student_id")?.trim();
  if ((relationship !== "self" && relationship !== "dependent") || !studentId) return null;
  const surface = area.surfaces.find((entry) => entry.key === `calendar:${relationship}:${studentId}`);
  if (!surface) return null;
  const relationshipScope = surface.scopes.find((scope) => scope.kind === relationship && scope.id === studentId);
  return {
    manifest,
    area,
    surface,
    schoolId: manifest.context.institution_id,
    basePath: "/areas/events/calendar",
    relationship,
    studentId,
    relationshipLabel: relationshipScope?.label ?? null,
  };
}

function EventsRouteState({ state, error, retry }: { state: "loading" | "error" | "revoked" | "unavailable"; error?: unknown; retry?: () => unknown }) {
  return <OperationsShell active="areas" title="Events & activities">
    <WorkspaceState state={state} error={error} onRetry={retry} />
  </OperationsShell>;
}

function EventsWorkspaceBoundary({ requested, children }: { requested: RequestedSurface; children: (access: EventsWorkspaceAccess) => ReactNode }) {
  const environment = useExecutionEnvironment();
  const query = useWorkspaceManifest();
  const [search] = useSearchParams();
  if (environment.mode === "simulation" && environment.unavailable === true) return <EventsRouteState state="unavailable" />;
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.error) {
    const revoked = query.error instanceof ApiError && query.error.status === 403;
    return <EventsRouteState state={revoked ? "revoked" : "error"} error={query.error} retry={query.refetch} />;
  }
  if (!query.data || !manifestMatchesEnvironment(query.data, environment)) {
    return <EventsRouteState state="error" error={new Error("The Events workspace did not match the active environment.")} retry={query.refetch} />;
  }
  const access = resolveEventsWorkspaceAccess(query.data, requested, search);
  if (!access) return <EventsRouteState state="revoked" retry={query.refetch} />;
  return children(access);
}

function useEventInvalidation() {
  const client = useQueryClient();
  return async (eventId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["campus-events"] }),
      ...(eventId ? [client.invalidateQueries({ queryKey: ["campus-event", eventId] })] : []),
      ...(eventId ? [client.invalidateQueries({ queryKey: ["campus-event-finance", eventId] })] : []),
      client.invalidateQueries({ queryKey: ["responsibility-workspace"] }),
      client.invalidateQueries({ queryKey: ["notifications"] }),
      client.invalidateQueries({ queryKey: ["attention"] }),
      client.invalidateQueries({ queryKey: ["requests"] }),
    ]);
  };
}

function OperationsList({ access }: { access: EventsWorkspaceAccess }) {
  const [search, setSearch] = useSearchParams();
  const view = search.get("view") === "draft" || search.get("view") === "past" ? search.get("view") as EventView : "upcoming";
  const query = useInfiniteQuery({
    queryKey: ["campus-events", "workspace", access.surface.key, access.schoolId],
    queryFn: ({ pageParam }) => getCampusEvents(access.schoolId, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.isError) return <EventsRouteState state="error" error={query.error} retry={query.refetch} />;
  return <OperationsEventListPage
    workspace={{ basePath: access.basePath, kind: access.operationsKind! }}
    events={query.data.pages.flatMap((page) => page.items)}
    view={view}
    hasMore={query.hasNextPage}
    loadingMore={query.isFetchingNextPage}
    onLoadMore={() => void query.fetchNextPage()}
    onViewChange={(next) => {
      const updated = new URLSearchParams(search);
      if (next === "upcoming") updated.delete("view"); else updated.set("view", next);
      setSearch(updated, { replace: true });
    }}
  />;
}

function OperationsDetail({ access }: { access: EventsWorkspaceAccess }) {
  const auth = useOptionalAuth();
  const { eventId = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useEventInvalidation();
  const query = useQuery({
    queryKey: ["campus-event", eventId, "workspace", access.surface.key],
    queryFn: () => getCampusEvent(access.schoolId, eventId),
    enabled: Boolean(eventId),
  });
  const finance = useQuery({
    queryKey: ["campus-event-finance", eventId, "workspace", access.surface.key],
    queryFn: () => getCampusEventFinance(access.schoolId, eventId),
    enabled: Boolean(eventId),
  });
  if (!eventId) return <EventsRouteState state="revoked" />;
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.isError || !query.data) return <EventsRouteState state="error" error={query.error} retry={query.refetch} />;
  const revision = Number(search.get("event_revision"));
  const attentionTarget: OperationsEventAttentionTarget = {
    notificationId: search.get("attention_notification_id"),
    focus: search.get("focus"),
    eventRevision: Number.isSafeInteger(revision) && revision > 0 ? revision : null,
  };
  const event = query.data;
  return <>
    <OperationsEventAttentionGate event={event} target={attentionTarget} />
    <OperationsEventDetailPage
      workspace={{ basePath: access.basePath, kind: access.operationsKind! }}
      schoolId={access.schoolId}
      viewerUserId={auth?.user?.id}
      event={event}
      finance={finance.data}
      financeError={finance.isError ? finance.error : undefined}
      onRecordRefund={async (studentId, input) => {
        await recordCampusEventRefund(access.schoolId, event.id, studentId, input);
        await Promise.all([refresh(event.id), finance.refetch()]);
      }}
      onAuthorityChanged={async () => { await refresh(event.id); await query.refetch(); }}
      onAction={async (action) => {
        await transitionCampusEvent(access.schoolId, event.id, action, event.revision);
        await refresh(event.id);
        if (action === "discard") void navigate(eventWorkspaceListHref(access.basePath, search), { replace: true });
        else await query.refetch();
      }}
      onCancel={async (internalReason, audienceNotice) => {
        await cancelCampusEvent(access.schoolId, event.id, event.revision, internalReason, audienceNotice);
        await refresh(event.id);
        await query.refetch();
      }}
    />
  </>;
}

function OperationsEditor({ access }: { access: EventsWorkspaceAccess }) {
  const { eventId } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const refresh = useEventInvalidation();
  const catalog = useQuery({ queryKey: ["campus-events", "catalog", "workspace", access.schoolId], queryFn: () => getCampusEventCatalog(access.schoolId) });
  const detail = useQuery({
    queryKey: ["campus-event", eventId, "workspace", access.surface.key],
    queryFn: () => getCampusEvent(access.schoolId, eventId!),
    enabled: Boolean(eventId),
  });
  if (catalog.isPending || (eventId && detail.isPending)) return <EventsRouteState state="loading" />;
  if (catalog.isError) return <EventsRouteState state="error" error={catalog.error} retry={catalog.refetch} />;
  if (detail.isError) return <EventsRouteState state="error" error={detail.error} retry={detail.refetch} />;
  const existing = detail.data;
  if (existing && !existing.permissions.can_edit) return <EventsRouteState state="revoked" />;
  const save = async (input: CampusEventInput) => {
    const saved = existing
      ? await saveCampusEvent(access.schoolId, existing.id, existing.revision, input)
      : await createCampusEvent(access.schoolId, input);
    await refresh(saved.id);
    void navigate(eventWorkspaceDetailHref(access.basePath, saved.id, search), { replace: true });
  };
  const workspace = { basePath: access.basePath, kind: access.operationsKind! };
  return existing?.event_type === "class_test"
    ? <ClassTestEditorPage workspace={workspace} catalog={catalog.data} event={existing} onSave={save} />
    : <EventEditorPage workspace={workspace} catalog={catalog.data} event={existing} onSave={save} />;
}

function OperationsRegister({ access }: { access: EventsWorkspaceAccess }) {
  const { eventId = "", sessionId = "" } = useParams();
  const [search] = useSearchParams();
  const client = useQueryClient();
  const key = ["campus-event-register", eventId, sessionId, "workspace", access.surface.key];
  const query = useQuery({ queryKey: key, queryFn: () => getEventRegister(access.schoolId, eventId, sessionId), enabled: Boolean(eventId && sessionId) });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ["campus-event", eventId] }),
      client.invalidateQueries({ queryKey: ["campus-events"] }),
      client.invalidateQueries({ queryKey: ["responsibility-workspace"] }),
    ]);
    await query.refetch();
  };
  if (!eventId || !sessionId) return <EventsRouteState state="revoked" />;
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.isError || !query.data) return <EventsRouteState state="error" error={query.error} retry={query.refetch} />;
  const workspace = { basePath: access.basePath, kind: access.operationsKind! };
  return <EventRegisterPage
    key={`${query.data.session.revision}-${query.data.session.state}`}
    workspace={workspace}
    backTo={eventWorkspaceDetailHref(access.basePath, eventId, search)}
    register={query.data}
    onHistory={() => getEventRegisterHistory(access.schoolId, eventId, sessionId)}
    onSave={async (input) => { await saveEventRegister(access.schoolId, eventId, sessionId, input); await refresh(); }}
    onLock={async (reason) => { await changeEventRegisterLock(access.schoolId, eventId, sessionId, "lock", query.data.session.revision, reason); await refresh(); }}
    onReopen={async (reason) => { await changeEventRegisterLock(access.schoolId, eventId, sessionId, "reopen", query.data.session.revision, reason); await refresh(); }}
  />;
}

function relationshipWorkspace(access: EventsWorkspaceAccess): RelationshipEventWorkspace {
  return {
    basePath: access.basePath,
    relationship: access.relationship!,
    studentId: access.studentId!,
    relationshipLabel: access.relationshipLabel,
  };
}

function RelationshipList({ access }: { access: EventsWorkspaceAccess }) {
  const [search, setSearch] = useSearchParams();
  const view = search.get("view") === "past" ? "past" : "upcoming";
  const query = useInfiniteQuery({
    queryKey: ["campus-events", "relationship", access.relationship, access.studentId, access.schoolId],
    queryFn: ({ pageParam }) => getCampusEvents(access.schoolId, { studentId: access.studentId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  });
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.isError) return <EventsRouteState state="error" error={query.error} retry={query.refetch} />;
  return <FamilyEventListPage
    audience={access.relationship === "dependent" ? "parent" : "student"}
    workspace={relationshipWorkspace(access)}
    events={query.data.pages.flatMap((page) => page.items)}
    view={view}
    onViewChange={(next) => {
      const updated = new URLSearchParams(search);
      if (next === "past") updated.set("view", "past"); else updated.delete("view");
      setSearch(updated, { replace: true });
    }}
    hasMore={query.hasNextPage}
    loadingMore={query.isFetchingNextPage}
    onLoadMore={() => void query.fetchNextPage()}
  />;
}

function RelationshipDetail({ access }: { access: EventsWorkspaceAccess }) {
  const { eventId = "" } = useParams();
  const [search] = useSearchParams();
  const client = useQueryClient();
  const studentId = access.studentId!;
  const query = useQuery({
    queryKey: ["campus-event", eventId, "relationship", access.relationship, studentId],
    queryFn: () => getCampusEvent(access.schoolId, eventId, studentId),
    enabled: Boolean(eventId),
  });
  const finance = useQuery({
    queryKey: ["campus-event-finance", eventId, "relationship", access.relationship, studentId],
    queryFn: () => getCampusEventFinance(access.schoolId, eventId, studentId),
    enabled: Boolean(eventId),
  });
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["campus-event", eventId] }),
      client.invalidateQueries({ queryKey: ["campus-event-finance", eventId] }),
      client.invalidateQueries({ queryKey: ["campus-events"] }),
      client.invalidateQueries({ queryKey: ["responsibility-workspace"] }),
    ]);
    await Promise.all([query.refetch(), finance.refetch()]);
  };
  if (!eventId) return <EventsRouteState state="revoked" />;
  if (query.isPending) return <EventsRouteState state="loading" />;
  if (query.isError || !query.data) return <EventsRouteState state="error" error={query.error} retry={query.refetch} />;
  const event = query.data;
  const participant = event.viewer_participants.find((item) => item.student_id === studentId);
  if (!participant) return <EventsRouteState state="revoked" />;
  const expectedRevision = Number(search.get("event_revision"));
  const withdrawalId = search.get("withdrawal_id");
  const refundId = search.get("refund_id");
  const exactAttention = access.relationship === "dependent" && (
    (search.get("focus") === "status" && event.status === "cancelled" && event.revision === expectedRevision)
    || (withdrawalId !== null && finance.data?.items.some((item) => item.student_id === studentId && item.withdrawal_id === withdrawalId))
    || (refundId !== null && finance.data?.items.some((item) => item.student_id === studentId && item.refunds.some((refund) => refund.id === refundId)))
  );
  const hasTypedAttention = Boolean(search.get("attention_notification_id") && (search.get("event_revision") || withdrawalId || refundId));
  const attentionSettled = search.get("focus") === "status" || !finance.isPending;
  const withConflictRefresh = async (command: () => Promise<unknown>) => {
    try { await command(); await refresh(); }
    catch (error) {
      if (error instanceof ApiError && error.status === 409) await refresh();
      throw error;
    }
  };
  return <>
    {exactAttention ? <AttentionOpenAcknowledgement /> : null}
    {access.relationship === "dependent" && hasTypedAttention && attentionSettled && !exactAttention
      ? <AttentionTargetUnavailable message="This event update no longer matches the current record. It was not marked as opened." />
      : null}
    <FamilyEventDetailPage
      audience={access.relationship === "dependent" ? "parent" : "student"}
      workspace={relationshipWorkspace(access)}
      event={event}
      finance={finance.data?.items.find((item) => item.student_id === studentId)}
      financeError={finance.isError ? finance.error : undefined}
      selectedStudentId={studentId}
      listView={search.get("view") === "past" || search.get("list_view") === "past" ? "past" : "upcoming"}
      focusAction={readFamilyEventActionFocus(search.get("focus"))}
      onRsvp={(status) => withConflictRefresh(() => respondToCampusEvent(access.schoolId, event.id, studentId, status, participant.rsvp_revision))}
      onWithdraw={async (reason, idempotencyKey) => { await withdrawFromPaidCampusEvent(access.schoolId, event.id, studentId, reason, idempotencyKey); await refresh(); }}
      onConsent={(status, note) => withConflictRefresh(() => recordCampusEventConsent(access.schoolId, event.id, studentId, status, note, participant.consent_revision))}
      onChecklist={async (itemId, completed) => { await updateCampusEventChecklist(access.schoolId, event.id, itemId, studentId, completed); await refresh(); }}
    />
  </>;
}

export const WorkspaceEventsManageRoute = () => <EventsWorkspaceBoundary requested="manage">{(access) => <OperationsList access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsManageDetailRoute = () => <EventsWorkspaceBoundary requested="manage">{(access) => <OperationsDetail access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsManageCreateRoute = () => <EventsWorkspaceBoundary requested="manage">{(access) => <OperationsEditor access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsManageEditRoute = () => <EventsWorkspaceBoundary requested="manage">{(access) => <OperationsEditor access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsManageRegisterRoute = () => <EventsWorkspaceBoundary requested="manage">{(access) => <OperationsRegister access={access} />}</EventsWorkspaceBoundary>;

export const WorkspaceEventsAssignedRoute = () => <EventsWorkspaceBoundary requested="assigned">{(access) => <OperationsList access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsAssignedDetailRoute = () => <EventsWorkspaceBoundary requested="assigned">{(access) => <OperationsDetail access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsAssignedEditRoute = () => <EventsWorkspaceBoundary requested="assigned">{(access) => <OperationsEditor access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsAssignedRegisterRoute = () => <EventsWorkspaceBoundary requested="assigned">{(access) => <OperationsRegister access={access} />}</EventsWorkspaceBoundary>;

export const WorkspaceEventsCalendarRoute = () => <EventsWorkspaceBoundary requested="calendar">{(access) => <RelationshipList access={access} />}</EventsWorkspaceBoundary>;
export const WorkspaceEventsCalendarDetailRoute = () => <EventsWorkspaceBoundary requested="calendar">{(access) => <RelationshipDetail access={access} />}</EventsWorkspaceBoundary>;
