import { useAttention } from "../attention/useAttention";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useOptionalAuth, type MembershipRole } from "../auth/AuthContext";
import { getAccessibleStudents } from "../school/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";
import type { ParentChildSummary } from "../../pages/parent/parentTypes";
import { ApiError } from "../../lib/api";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { searchForStudentContext } from "../navigation/studentContextSearch";
import {
  cancelCampusEvent,
  changeEventRegisterLock,
  createCampusEvent,
  getCampusEvent,
  getCampusEventFinance,
  getCampusEventCatalog,
  getCampusEvents,
  getEventRegister,
  getEventRegisterHistory,
  getFamilyCampusEvents,
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
import { eventDetailHref, eventListHref } from "./eventNavigation";
import { EventRegisterPage } from "./EventRegisterPage";
import { FamilyEventDetailPage, FamilyEventListPage, readFamilyEventActionFocus } from "./FamilyEventPages";
import { OperationsEventDetailPage } from "./OperationsEventDetailPage";
import { OperationsEventListPage, type EventView } from "./OperationsEventListPage";
import type { CampusEventDto, CampusEventInput } from "./types";

function useSchoolId(role: MembershipRole) {
  const auth = useOptionalAuth();
  return auth?.memberships.find((membership) => membership.role === role)?.school_id ?? "";
}

function RouteFailure({ error, retry }: { error: unknown; retry?: () => unknown }) {
  return <LiveRouteError error={error instanceof Error ? error : new Error("This event workspace is unavailable.")} onRetry={retry ?? (() => window.location.reload())} />;
}

export interface OperationsEventAttentionTarget {
  notificationId: string | null;
  focus: string | null;
  eventRevision: number | null;
}

export function operationsEventAttentionResolution(
  event: Pick<CampusEventDto, "status" | "revision">,
  target: OperationsEventAttentionTarget,
): "none" | "exact" | "stale" {
  if (!target.notificationId) return "none";
  if (target.focus !== "status" || !target.eventRevision) return "stale";
  return event.status === "cancelled" && event.revision === target.eventRevision ? "exact" : "stale";
}

export function OperationsEventAttentionGate({
  event,
  target,
}: {
  event: Pick<CampusEventDto, "status" | "revision">;
  target: OperationsEventAttentionTarget;
}) {
  const resolution = operationsEventAttentionResolution(event, target);
  if (resolution === "exact") return <AttentionOpenAcknowledgement />;
  if (resolution === "stale") {
    return <AttentionTargetUnavailable message="This event cancellation no longer matches the current record. It was not marked as opened." />;
  }
  return null;
}

function useEventInvalidation() {
  const client = useQueryClient();
  return async (eventId?: string) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["campus-events"] }),
      ...(eventId ? [client.invalidateQueries({ queryKey: ["campus-event", eventId] })] : []),
      ...(eventId ? [client.invalidateQueries({ queryKey: ["campus-event-finance", eventId] })] : []),
      client.invalidateQueries({ queryKey: ["notifications"] }),
      client.invalidateQueries({ queryKey: ["attention"] }),
      client.invalidateQueries({ queryKey: ["requests"] }),
      client.invalidateQueries({ queryKey: ["school", "parent", "home"] }),
      client.invalidateQueries({ queryKey: ["school", "student", "home"] }),
      client.invalidateQueries({ queryKey: ["teacher-home"] }),
      client.invalidateQueries({ queryKey: ["principal-home"] }),
    ]);
  };
}

function OperationsListRoute({ portal }: { portal: "teacher" | "principal" }) {
  const attention = useAttention(portal);
  const schoolId = useSchoolId(portal === "principal" ? "admin" : "staff");
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as EventView | null) ?? "upcoming";
  const query = useInfiniteQuery({
    queryKey: ["campus-events", portal, schoolId],
    queryFn: ({ pageParam }) => getCampusEvents(schoolId, { cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: Boolean(schoolId),
  });
  if (!schoolId) return <RouteFailure error={new Error("No active school membership is available for this portal.")} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError) return <RouteFailure error={query.error} retry={query.refetch} />;
  const events = query.data.pages.flatMap((page) => page.items);
  return <OperationsEventListPage portal={portal} attentionItems={attention.data?.items.filter(item => item.module === "events") ?? []} events={events} view={view} hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} onViewChange={(next) => { const updated = new URLSearchParams(params); updated.set("view", next); setParams(updated, { replace: true }); }} />;
}

function OperationsDetailRoute({ portal }: { portal: "teacher" | "principal" }) {
  const auth = useOptionalAuth();
  const { eventId = "" } = useParams();
  const schoolId = useSchoolId(portal === "principal" ? "admin" : "staff");
  const refresh = useEventInvalidation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const query = useQuery({ queryKey: ["campus-event", eventId, portal], queryFn: () => getCampusEvent(schoolId, eventId), enabled: Boolean(schoolId && eventId) });
  const finance = useQuery({ queryKey: ["campus-event-finance", eventId, portal], queryFn: () => getCampusEventFinance(schoolId, eventId), enabled: Boolean(schoolId && eventId) });
  if (!schoolId || !eventId) return <RouteFailure error={new Error("This event is not available in the active school workspace.")} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <RouteFailure error={query.error} retry={query.refetch} />;
  const event = query.data;
  const revisionValue = Number(params.get("event_revision"));
  const attentionTarget: OperationsEventAttentionTarget = {
    notificationId: params.get("attention_notification_id"),
    focus: params.get("focus"),
    eventRevision: Number.isSafeInteger(revisionValue) && revisionValue > 0 ? revisionValue : null,
  };
  return <><OperationsEventAttentionGate event={event} target={attentionTarget} /><OperationsEventDetailPage portal={portal} schoolId={schoolId} viewerUserId={auth?.user?.id} event={event} finance={finance.data} financeError={finance.isError ? finance.error : undefined} onRecordRefund={async (studentId, input) => { await recordCampusEventRefund(schoolId, event.id, studentId, input); await Promise.all([refresh(event.id), finance.refetch()]); }} onAuthorityChanged={async () => { await refresh(event.id); await query.refetch(); }} onAction={async (action) => {
    await transitionCampusEvent(schoolId, event.id, action, event.revision);
    await refresh(event.id);
    if (action === "discard") void navigate(eventListHref(`/${portal}`, params), { replace: true }); else await query.refetch();
  }} onCancel={async (internalReason, audienceNotice) => { await cancelCampusEvent(schoolId, event.id, event.revision, internalReason, audienceNotice); await refresh(event.id); await query.refetch(); }} /></>;
}

function EventEditorRoute({ portal }: { portal: "teacher" | "principal" }) {
  const { eventId } = useParams();
  const schoolId = useSchoolId(portal === "principal" ? "admin" : "staff");
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const refresh = useEventInvalidation();
  const catalog = useQuery({ queryKey: ["campus-events", "catalog", portal, schoolId], queryFn: () => getCampusEventCatalog(schoolId), enabled: Boolean(schoolId) });
  const detail = useQuery({ queryKey: ["campus-event", eventId, portal], queryFn: () => getCampusEvent(schoolId, eventId!), enabled: Boolean(schoolId && eventId) });
  if (!schoolId) return <RouteFailure error={new Error("No active school membership is available for this portal.")} />;
  if (catalog.isPending || (eventId && detail.isPending)) return <ScreenLoading />;
  if (catalog.isError) return <RouteFailure error={catalog.error} retry={catalog.refetch} />;
  if (detail.isError) return <RouteFailure error={detail.error} retry={detail.refetch} />;
  const existing = detail.data;
  if (existing && !existing.permissions.can_edit) return <RouteFailure error={new Error("This event is no longer editable with your current role or event state.")} />;
  const save = async (input: CampusEventInput) => {
    const saved = existing ? await saveCampusEvent(schoolId, existing.id, existing.revision, input) : await createCampusEvent(schoolId, input);
    await refresh(saved.id);
    void navigate(eventDetailHref(`/${portal}`, saved.id, params), { replace: true });
  };
  return existing?.event_type === "class_test"
    ? <ClassTestEditorPage portal={portal} catalog={catalog.data} event={existing} onSave={save} />
    : <EventEditorPage portal={portal} catalog={catalog.data} event={existing} onSave={save} />;
}

function RegisterRoute({ portal }: { portal: "teacher" | "principal" }) {
  const { eventId = "", sessionId = "" } = useParams();
  const [params] = useSearchParams();
  const schoolId = useSchoolId(portal === "principal" ? "admin" : "staff");
  const client = useQueryClient();
  const key = ["campus-event-register", eventId, sessionId];
  const query = useQuery({ queryKey: key, queryFn: () => getEventRegister(schoolId, eventId, sessionId), enabled: Boolean(schoolId && eventId && sessionId) });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: key }), client.invalidateQueries({ queryKey: ["campus-event", eventId] }), client.invalidateQueries({ queryKey: ["campus-events"] })]); await query.refetch(); };
  if (!schoolId || !eventId || !sessionId) return <RouteFailure error={new Error("This event register is not available in the active school workspace.")} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <RouteFailure error={query.error} retry={query.refetch} />;
  return <EventRegisterPage key={`${query.data.session.revision}-${query.data.session.state}`} portal={portal} backTo={eventDetailHref(`/${portal}`, eventId, params)} register={query.data} onHistory={() => getEventRegisterHistory(schoolId, eventId, sessionId)} onSave={async (input) => { await saveEventRegister(schoolId, eventId, sessionId, input); await refresh(); }} onLock={async (reason) => { await changeEventRegisterLock(schoolId, eventId, sessionId, "lock", query.data.session.revision, reason); await refresh(); }} onReopen={async (reason) => { await changeEventRegisterLock(schoolId, eventId, sessionId, "reopen", query.data.session.revision, reason); await refresh(); }} />;
}

function toParentChild(student: Awaited<ReturnType<typeof getAccessibleStudents>>["results"][number]): ParentChildSummary {
  return { id: student.id, name: student.user.display_name, grade: `Grade ${student.current_enrollment.grade}`, section: student.current_enrollment.section, board: student.current_enrollment.board, rollNumber: String(student.current_enrollment.roll_number), avatarUrl: student.avatar_url };
}

function useParentStudentSelection(enabled: boolean, selectFirstWhenMissing = true) {
  const [params, setParams] = useSearchParams();
  const students = useQuery({ queryKey: ["school", "accessible-students"], queryFn: getAccessibleStudents, enabled });
  const requestedId = params.get("student_id");
  const requestedIsAccessible = students.data?.results.some((student) => student.id === requestedId) ?? false;
  const studentId = requestedIsAccessible
    ? requestedId!
    : requestedId || selectFirstWhenMissing
      ? students.data?.results[0]?.id
      : undefined;
  useEffect(() => {
    if (!enabled || !students.data || !studentId || requestedId === studentId || (!requestedId && !selectFirstWhenMissing)) return;
    setParams(searchForStudentContext(params, studentId), { replace: true });
  }, [enabled, params, requestedId, selectFirstWhenMissing, setParams, studentId, students.data]);
  return { students, params, requestedId, setParams, studentId };
}

function FamilyListRoute({ audience }: { audience: "parent" | "student" }) {
  const role = audience === "parent" ? "guardian" : "student";
  const schoolId = useSchoolId(role);
  const { students, params, setParams, studentId: selectedStudentId } = useParentStudentSelection(audience === "parent");
  const studentId = audience === "parent" ? selectedStudentId : undefined;
  const view = params.get("view") === "past" ? "past" : "upcoming";
  const query = useInfiniteQuery({
    queryKey: ["campus-events", audience, schoolId, studentId ?? "self"],
    queryFn: ({ pageParam }) => getFamilyCampusEvents(schoolId, studentId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    enabled: Boolean(schoolId && (audience === "student" || studentId)),
  });
  if (!schoolId) return <RouteFailure error={new Error("No active school membership is available for this portal.")} />;
  if (audience === "parent" && students.isPending) return <ScreenLoading />;
  if (students.isError) return <RouteFailure error={students.error} retry={students.refetch} />;
  if (audience === "parent" && students.data?.results.length === 0) return <FamilyEventListPage audience="parent" events={[]} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError) return <RouteFailure error={query.error} retry={query.refetch} />;
  const selected = students.data?.results.find((student) => student.id === studentId);
  const events = query.data.pages.flatMap((page) => page.items);
  return <FamilyEventListPage audience={audience} events={events} view={view} onViewChange={(nextView) => { const updated = new URLSearchParams(params); if (nextView === "past") updated.set("view", nextView); else updated.delete("view"); setParams(updated, { replace: true }); }} hasMore={query.hasNextPage} loadingMore={query.isFetchingNextPage} onLoadMore={() => void query.fetchNextPage()} child={selected ? toParentChild(selected) : undefined} onSelectChild={audience === "parent" ? (next) => setParams(searchForStudentContext(params, next), { replace: true }) : undefined} />;
}

function FamilyDetailRoute({ audience }: { audience: "parent" | "student" }) {
  const { eventId = "" } = useParams();
  const schoolId = useSchoolId(audience === "parent" ? "guardian" : "student");
  const { students, params, requestedId, setParams, studentId: authorizedStudentId } = useParentStudentSelection(audience === "parent", false);
  const selectedId = audience === "parent" ? authorizedStudentId : undefined;
  const query = useQuery({ queryKey: ["campus-event", eventId, audience, selectedId ?? "guardian"], queryFn: () => getCampusEvent(schoolId, eventId, selectedId), enabled: Boolean(schoolId && eventId && (audience === "student" || students.data)) });
  const financeStudentId = selectedId ?? query.data?.viewer_participants[0]?.student_id;
  const finance = useQuery({ queryKey: ["campus-event-finance", eventId, audience, financeStudentId ?? "none"], queryFn: () => getCampusEventFinance(schoolId, eventId, financeStudentId), enabled: Boolean(schoolId && eventId && financeStudentId) });
  const client = useQueryClient();
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ["campus-event", eventId] }), client.invalidateQueries({ queryKey: ["campus-event-finance", eventId] }), client.invalidateQueries({ queryKey: ["campus-events"] })]); await Promise.all([query.refetch(), financeStudentId ? finance.refetch() : Promise.resolve()]); };
  const inferredStudentId = audience === "parent" && !requestedId
    ? query.data?.viewer_participants.find((participant) => students.data?.results.some((student) => student.id === participant.student_id))?.student_id
    : undefined;
  useEffect(() => {
    if (!inferredStudentId) return;
    const updated = new URLSearchParams(params);
    updated.set("student_id", inferredStudentId);
    setParams(updated, { replace: true });
  }, [inferredStudentId, params, setParams]);
  if (!schoolId || !eventId) return <RouteFailure error={new Error("This event is not available in the active school workspace.")} />;
  if (audience === "parent" && students.isPending) return <ScreenLoading />;
  if (students.isError) return <RouteFailure error={students.error} retry={students.refetch} />;
  if (audience === "parent" && students.data?.results.length === 0) return <FamilyEventListPage audience="parent" events={[]} />;
  if (query.isPending) return <ScreenLoading />;
  if (query.isError || !query.data) return <RouteFailure error={query.error} retry={query.refetch} />;
  const event = query.data;
  const participant = selectedId ? event.viewer_participants.find((item) => item.student_id === selectedId) : event.viewer_participants[0];
  const studentId = participant?.student_id ?? selectedId ?? "";
  const expectedEventRevision = Number(params.get("event_revision"));
  const withdrawalId = params.get("withdrawal_id");
  const refundId = params.get("refund_id");
  const exactAttentionTarget = audience === "parent" && (
    (params.get("focus") === "status" && event.status === "cancelled" && event.revision === expectedEventRevision)
    || (withdrawalId !== null && finance.data?.items.some((item) => item.student_id === studentId && item.withdrawal_id === withdrawalId))
    || (refundId !== null && finance.data?.items.some((item) => item.student_id === studentId && item.refunds.some((refund) => refund.id === refundId)))
  );
  const hasTypedAttentionTarget=Boolean(params.get("attention_notification_id")&&(params.get("event_revision")||withdrawalId||refundId));
  const attentionTargetSettled=params.get("focus")==="status"||!finance.isPending;
  const staleAttentionTarget=audience==="parent"&&hasTypedAttentionTarget&&attentionTargetSettled&&!exactAttentionTarget;
  const selected = students.data?.results.find((student) => student.id === studentId);
  const withConflictRefresh = async (command: () => Promise<unknown>) => {
    try {
      await command();
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) await refresh();
      throw error;
    }
  };
  return <>{exactAttentionTarget ? <AttentionOpenAcknowledgement /> : null}{staleAttentionTarget?<AttentionTargetUnavailable message="This event update no longer matches the current record. It was not marked as opened."/>:null}<FamilyEventDetailPage audience={audience} event={event} finance={finance.data?.items.find((item) => item.student_id === studentId)} financeError={finance.isError ? finance.error : undefined} child={selected ? toParentChild(selected) : undefined} selectedStudentId={studentId} listView={params.get("view") === "past" ? "past" : "upcoming"} focusAction={readFamilyEventActionFocus(params.get("focus"))} onSelectChild={audience === "parent" ? (next) => setParams(searchForStudentContext(params, next), { replace: true }) : undefined} onRsvp={(status) => withConflictRefresh(() => respondToCampusEvent(schoolId, event.id, studentId, status, participant?.rsvp_revision ?? 0))} onWithdraw={async (reason, idempotencyKey) => { await withdrawFromPaidCampusEvent(schoolId, event.id, studentId, reason, idempotencyKey); await refresh(); }} onConsent={(status, note) => withConflictRefresh(() => recordCampusEventConsent(schoolId, event.id, studentId, status, note, participant?.consent_revision ?? 0))} onChecklist={async (itemId, completed) => { await updateCampusEventChecklist(schoolId, event.id, itemId, studentId, completed); await refresh(); }} /></>;
}

export const PrincipalEventsRoute = () => <OperationsListRoute portal="principal" />;
export const PrincipalEventDetailRoute = () => <OperationsDetailRoute portal="principal" />;
export const PrincipalEventCreateRoute = () => <EventEditorRoute portal="principal" />;
export const PrincipalEventEditRoute = () => <EventEditorRoute portal="principal" />;
export const PrincipalEventRegisterRoute = () => <RegisterRoute portal="principal" />;
export const TeacherEventsRoute = () => <OperationsListRoute portal="teacher" />;
export const TeacherEventDetailRoute = () => <OperationsDetailRoute portal="teacher" />;
export const TeacherEventCreateRoute = () => <Navigate to="/teacher/assessments?create=class-test" replace />;
export const TeacherEventEditRoute = () => <EventEditorRoute portal="teacher" />;
export const TeacherEventRegisterRoute = () => <RegisterRoute portal="teacher" />;
export const ParentEventsRoute = () => <FamilyListRoute audience="parent" />;
export const ParentEventDetailRoute = () => <FamilyDetailRoute audience="parent" />;
export const StudentEventsRoute = () => <FamilyListRoute audience="student" />;
export const StudentEventDetailRoute = () => <FamilyDetailRoute audience="student" />;
