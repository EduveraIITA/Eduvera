import {
  BadgeCheck,
  CalendarCheck2,
  CalendarClock,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Handshake,
  MapPin,
  Plus,
  RotateCcw,
  Scale,
  Settings2,
  ShieldCheck,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { CollectionView } from "../../components/CollectionView";
import { InfoSummary } from "../../components/InfoSummary";
import { browserHistoryIndex, previousPortalLocation } from "../navigation/portalHistory";
import { samePortalHref } from "../navigation/portalReturnState";
import {
  adjustStaffBalance,
  createStaffProfile,
  decideStaffLeave,
  enableLeaveReviewRouting,
  getStaffWorkspace,
  getLeaveReviewRouting,
  previewStaffLeaveImpact,
  rerouteStaffLeave,
  respondCoverage,
  respondResponsibility,
  saveLeavePolicy,
  submitStaffLeave,
  updateStaffOnboarding,
  withdrawStaffLeave,
  type AdminStaffWorkspace,
  type CoverageTask,
  type LeaveBalance,
  type LeavePolicy,
  type LeaveReviewReadiness,
  type LeaveReviewRouting,
  type ResponsibilityAssignment,
  type StaffLeaveRequest,
  type StaffLeaveImpact,
  type StaffLeaveImpactInput,
  type StaffProfile,
  type StaffWorkspace,
  type TeacherStaffWorkspace,
} from "./api";
import { ApiError } from "../../lib/api";
import {
  clearPendingStaffLeaveCommand,
  isDefinitiveStaffLeaveFailure,
  pendingStaffLeaveCommand,
  type StaffLeaveCommandScope,
} from "./pendingLeaveCommand";
import {
  clearPendingStaffCoverageCommand,
  isDefinitiveStaffCoverageFailure,
  pendingStaffCoverageCommand,
  type StaffCoverageCommandScope,
} from "./pendingCoverageCommand";
import { AccessRolesPanel } from "./AccessRolesPanel";
import { MyRoleAssignments, StaffRoleAssignments } from "./StaffRoleAssignments";
import { CoverageBoard } from "./StaffLeaveCoverage";
import { AttentionOpenAcknowledgement } from "../attention/AttentionOpenAcknowledgement";
import { AttentionTargetUnavailable } from "../attention/AttentionTargetUnavailable";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import "./staff-operations.css";

import { TemporalInput } from "../../components/forms/TemporalInput";
type PrincipalSection = "directory" | "roles" | "leave" | "policies";
function staffDirectoryParams(params: URLSearchParams) {
  const next = new URLSearchParams({ section: "directory" });
  for (const key of ["school", "staff_search", "staff_filter", "staff_page"]) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return next;
}
const displayDate = (value: string) =>
  new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${value}T12:00:00+05:30`));
const number = (value: string | number) => Number(value || 0);
const days = (value: number) =>
  Number.isInteger(value) ? `${value}` : value.toFixed(1);
const leaveWorkCount = (request: StaffLeaveRequest) => request.status === "approved"
  ? request.coverage_tasks ?? request.affected_periods
  : request.affected_periods;
const formValue = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
};
const staffName = (profile: Pick<StaffProfile, "first_name" | "last_name">) =>
  `${profile.first_name} ${profile.last_name}`.trim();
const expectedRevision = (value: string | null) => {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
};
function useAttentionFocus(sourceId: string | null) {
  useEffect(() => {
    if (!sourceId) return;
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(`attention-${sourceId}`);
      target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [sourceId]);
}

interface LeaveCommandAction {
  operation: StaffLeaveCommandScope["operation"];
  targetId: string;
  material: Record<string, unknown>;
  execute: (commandId: string) => Promise<unknown>;
  acceptedMessage: string;
  onAccepted?: () => void;
}

// A response can be lost after a commit. Keep the exact command available for
// replay, and never repeat a confirmed write just because its refresh failed.
function useLeaveCommand(schoolId: string, actorId: string, refresh: () => Promise<void>) {
  const environment = useOptionalExecutionEnvironment();
  const worldKey = environment?.mode === "simulation" ? `${environment.namespaceId}:${environment.runId}` : "live";
  const inFlight = useRef(false);
  const [busy, setBusy] = useState("");
  const [busyOperation, setBusyOperation] = useState<LeaveCommandAction["operation"] | null>(null);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{ kind: "unknown" | "refresh"; action?: LeaveCommandAction } | null>(null);

  async function reload() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("refresh");
    try {
      await refresh();
      setRecovery(null);
      setError("");
    } catch {
      setError("Couldn’t refresh requests. No action was repeated.");
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  async function run(action: LeaveCommandAction, replay = false) {
    if (inFlight.current || recovery && !replay) return;
    inFlight.current = true;
    setBusy(action.targetId);
    setBusyOperation(action.operation);
    setError("");
    const scope = { schoolId, actorId, operation: action.operation, targetId: action.targetId, worldKey };
    let command: Awaited<ReturnType<typeof pendingStaffLeaveCommand>> | undefined;
    try {
      command = await pendingStaffLeaveCommand(scope, action.material);
      await action.execute(command.commandId);
      clearPendingStaffLeaveCommand(scope, command);
      action.onAccepted?.();
      try {
        await refresh();
        setRecovery(null);
      } catch {
        setRecovery({ kind: "refresh" });
        setError(`${action.acceptedMessage} Couldn’t load the latest status. Refresh requests before acting again.`);
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The request could not be completed.";
      if (isDefinitiveStaffLeaveFailure(cause)) {
        if (command) clearPendingStaffLeaveCommand(scope, command);
        const stale = cause instanceof ApiError && [403, 404, 409, 412].includes(cause.status);
        setRecovery(stale ? { kind: "refresh" } : null);
        setError(`${message}${stale ? " Refresh requests before acting again." : ""}`);
      } else {
        setRecovery({ kind: "unknown", action });
        setError(`The change is not confirmed. Retry the same action to check it safely. ${message}`);
      }
    } finally {
      inFlight.current = false;
      setBusy("");
      setBusyOperation(null);
    }
  }

  return {
    busy,
    busyOperation,
    blocked: Boolean(busy || recovery),
    error,
    recovery,
    run,
    refreshRequests: reload,
    recover: () => recovery?.kind === "unknown" && recovery.action ? run(recovery.action, true) : reload(),
  };
}

function LeaveCommandFeedback({ command }: { command: ReturnType<typeof useLeaveCommand> }) {
  if (!command.error) return null;
  return <div className="staff-leave-feedback" role="alert">
    <p>{command.error}</p>
    {command.recovery ? <button type="button" className="staff-secondary" disabled={Boolean(command.busy)} onClick={() => void command.recover()}>
      {command.busy ? "Checking…" : command.recovery.kind === "unknown" ? "Retry same action" : "Refresh requests"}
    </button> : null}
  </div>;
}

function LeaveReviewRouteSummary({ request }: { request: StaffLeaveRequest }) {
  const route = request.review_route;
  if (!route || request.status !== "submitted") return null;
  return <div className={`staff-leave-route${route.state === "current" ? "" : " staff-leave-route--changed"}`}>
    {route.state === "current" ? <p>{route.reviewer ? <>Waiting for <strong>{route.reviewer.name}</strong></> : "Waiting for review"}</p> : <>
      <strong>{route.state === "needs_reassignment" ? "Reviewer changed" : "Review unavailable"}</strong>
      <p>{route.state === "needs_reassignment"
        ? `Previously sent to ${route.reviewer?.name || "the former reviewer"}.${route.current_reviewer ? ` ${route.current_reviewer.name} is now responsible.` : " A current reviewer is needed."}`
        : "A current leave reviewer is needed before this request can be decided."}</p>
    </>}
  </div>;
}

function LeaveReviewReadinessNotice({ schoolId, readiness, command, allowConfiguration = true }: {
  schoolId: string;
  readiness?: LeaveReviewReadiness;
  command: ReturnType<typeof useLeaveCommand>;
  allowConfiguration?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [routing, setRouting] = useState<LeaveReviewRouting | null>(null);
  if (!readiness) return null;
  if (readiness.state === "ready") return <p className="staff-review-ready">Sent to <strong>{readiness.reviewer?.name || "the current leave reviewer"}</strong> for approval</p>;
  async function prepare() {
    setChecking(true);
    setError("");
    try {
      const current = await getLeaveReviewRouting(schoolId);
      if (current.state === "ready") await command.refreshRequests();
      else if (current.can_configure && current.expected && current.reviewer) setRouting(current);
      else setError(current.reason || "Review setup changed. Refresh requests to check the current arrangement.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load review setup.");
    } finally { setChecking(false); }
  }
  async function enable() {
    if (!routing?.expected) return;
    const expected = routing.expected;
    await command.run({
      operation: "configure-routing",
      targetId: "review-routing",
      material: { expected, confirmed: true },
      execute: commandId => enableLeaveReviewRouting(schoolId, { command_id: commandId, expected, confirmed: true }),
      acceptedMessage: "Review requests were enabled.",
      onAccepted: () => setRouting(null),
    });
  }
  return <div className="staff-review-readiness">
    <div><strong>Leave review needs setup</strong><p>{readiness.reason || "A current reviewer and delivery arrangement are needed before submitting."}</p></div>
    {routing ? <div className="staff-review-confirmation">
      <p>Send leave requests to <strong>{routing.reviewer?.name}</strong>. No automatic decisions or reminders.</p>
      <div className="staff-request-actions">
        <button type="button" className="staff-secondary" disabled={command.blocked} onClick={() => setRouting(null)}>Cancel setup</button>
        <button type="button" className="staff-primary" disabled={command.blocked} onClick={() => void enable()}>{command.busy ? "Enabling…" : "Confirm and enable"}</button>
      </div>
    </div> : readiness.can_configure && allowConfiguration ? <button type="button" className="staff-secondary" disabled={checking || command.blocked} onClick={() => void prepare()}>{checking ? "Checking…" : "Enable review requests"}</button> : null}
    {!allowConfiguration && readiness.can_configure ? <Link to="/areas/responsibilities/leave?view=review">Open review setup</Link> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}

function LeavePolicyReadinessNotice({ canConfigure }: { canConfigure: boolean }) {
  return <div className="staff-review-readiness">
    <div><strong>No leave policy is available</strong><p>{canConfigure ? "Add an active policy for the current year before staff apply." : "Ask a campus administrator to make a leave policy available."}</p></div>
    {canConfigure ? <Link className="staff-secondary" to="/more/setup/responsibilities?section=policies">Open leave settings</Link> : null}
  </div>;
}

function StaffLeaveImpactPreview({ schoolId, actorId, input }: { schoolId: string; actorId: string; input: StaffLeaveImpactInput }) {
  const environment = useOptionalExecutionEnvironment();
  const worldKey = environment?.mode === "simulation" ? `${environment.namespaceId}:${environment.runId}` : "live";
  const { policy_id, starts_on, ends_on, portion } = input;
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: StaffLeaveImpact; error?: string } | null>(null);
  const valid = Boolean(policy_id && /^\d{4}-\d{2}-\d{2}$/.test(starts_on) && /^\d{4}-\d{2}-\d{2}$/.test(ends_on)
    && ends_on >= starts_on && (portion === "full_day" || starts_on === ends_on));
  const key = JSON.stringify([schoolId, actorId, worldKey, policy_id, starts_on, ends_on, portion, retry]);
  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => {
      void previewStaffLeaveImpact(schoolId, { policy_id, starts_on, ends_on, portion }, controller.signal).then(data => {
        if (current) { setPage(0); setResult({ key, data }); }
      }).catch((cause: unknown) => {
        if (current) setResult({ key, error: cause instanceof Error ? cause.message : "Affected work is unavailable." });
      });
    }, 200);
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [schoolId, policy_id, starts_on, ends_on, portion, valid, key]);
  if (!valid) return null;
  const current = result?.key === key ? result : null;
  const data = current?.data;
  const pageSize = 4;
  const pageCount = data ? Math.max(1, Math.ceil(data.items.length / pageSize)) : 1;
  const currentPage = Math.min(page, pageCount - 1);
  return <section className="staff-leave-impact" aria-labelledby="staff-leave-impact-title" aria-busy={!current}>
    <header><h2 id="staff-leave-impact-title">Work affected</h2>{data?.state === "ready" ? <span>{data.total} {data.total === 1 ? "activity" : "activities"}</span> : null}</header>
    {!current ? <p role="status">Checking published classes and dated duties…</p> : current.error ? <>
      <p role="alert">Couldn’t check affected work. {current.error}</p>
      <button className="staff-secondary" type="button" onClick={() => setRetry(value => value + 1)}>Retry work preview</button>
    </> : data ? <>
      {data.state === "empty" ? <p>No published classes or dated duties found.</p> : <ul>
        {data.items.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(item => <li key={item.id}>
          <strong>{item.title}</strong>
          <span>{[displayDate(item.date), item.starts_at && item.ends_at ? `${item.starts_at.slice(0, 5)}–${item.ends_at.slice(0, 5)}` : "Time not specified", item.class_label, item.location].filter(Boolean).join(" · ")}</span>
        </li>)}
      </ul>}
      {pageCount > 1 ? <nav aria-label="Affected work pages">
        <button type="button" className="staff-secondary" disabled={currentPage === 0} onClick={() => setPage(value => value - 1)}>Previous</button>
        <span>{currentPage + 1} of {pageCount}</span>
        <button type="button" className="staff-secondary" disabled={currentPage === pageCount - 1} onClick={() => setPage(value => value + 1)}>Next</button>
      </nav> : null}
      {data.truncated ? <p>Showing {data.items.length} of {data.total} affected activities.</p> : null}
      <p className="staff-leave-impact__note">Preview only. Approval checks the current work again.</p>
      <details><InfoSummary>Preview details</InfoSummary><p>Published timetable and dated responsibilities · {data.time_zone}</p>{data.limitations.map((limitation, index) => <p key={index}>{limitation}</p>)}</details>
    </> : null}
  </section>;
}

export function StaffOperationsPage({
  portal,
  schoolId,
  schoolName,
  data,
  refresh,
  teacherView = "leave",
  staffProfileId,
  actorId,
}: {
  portal: "principal" | "teacher";
  schoolId: string;
  schoolName?: string;
  data: StaffWorkspace;
  refresh: () => Promise<void>;
  teacherView?: "leave" | "responsibilities";
  staffProfileId?: string;
  actorId: string;
}) {
  if (portal === "teacher" && data.mode === "staff")
    return teacherView === "responsibilities" ? (
      <TeacherResponsibilitiesPage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    ) : (
      <TeacherLeavePage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    );
  if (portal === "principal" && data.mode === "admin")
    return staffProfileId ? (
      <PrincipalStaffDetailPage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        profileId={staffProfileId}
        refresh={refresh}
      />
    ) : (
      <PrincipalStaffPage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
        includeOperationalQueues
      />
    );
  return null;
}

export type StaffWorkspaceSurface = "setup" | "responsibilities" | "coverage" | "leave";

interface StaffOperationsWorkspacePageProps {
  surface: StaffWorkspaceSurface;
  schoolId: string;
  schoolName?: string;
  data: StaffWorkspace;
  refresh: () => Promise<void>;
  staffProfileId?: string;
  actorId: string;
}

/**
 * Canonical responsibility-composed entry point. The workspace returned by the
 * domain still owns every command and authorization decision; this component
 * only chooses the surface the manifest granted to the signed-in person.
 */
export function StaffOperationsWorkspacePage({
  surface,
  schoolId,
  schoolName,
  data,
  refresh,
  staffProfileId,
  actorId,
}: StaffOperationsWorkspacePageProps) {
  if (surface === "setup" && data.mode === "admin") {
    return staffProfileId ? (
      <PrincipalStaffDetailPage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        profileId={staffProfileId}
        refresh={refresh}
      />
    ) : (
      <PrincipalStaffPage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    );
  }

  if (surface === "leave") {
    return data.mode === "staff" ? (
      <TeacherLeavePage
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    ) : (
      <StaffLeaveReviewWorkspace
        schoolId={schoolId}
        schoolName={schoolName}
        actorId={actorId}
        data={data}
        refresh={refresh}
      />
    );
  }

  if (surface === "coverage") {
    return data.mode === "staff" ? (
      <TeacherResponsibilitiesPage
        surface="coverage"
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    ) : (
      <StaffCoverageWorkspace
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
      />
    );
  }

  if (surface === "responsibilities" && data.mode === "staff") {
    return (
      <TeacherResponsibilitiesPage
        surface="responsibilities"
        schoolId={schoolId}
        schoolName={schoolName}
        data={data}
        refresh={refresh}
        actorId={actorId}
      />
    );
  }

  return (
    <OperationsShell
      active={surface === "setup" ? "more" : "areas"}
      title={surface === "setup" ? "Staff setup" : "Responsibilities"}
      schoolName={schoolName}
      backTo={surface === "setup" ? "/more/setup" : "/areas/responsibilities"}
    >
      <div className="staff-page">
        <section className="staff-panel staff-profile-missing" role="status">
          <h2>This workspace is not assigned</h2>
          <p>Your current responsibilities do not include this surface. Ask an administrator to review your staff profile and assignments.</p>
          <Link className="staff-secondary" to="/areas/responsibilities">Open responsibilities</Link>
        </section>
      </div>
    </OperationsShell>
  );
}

export function AuthorizedStaffLeaveDecisionPage({
  schoolId,
  schoolName,
  actorId,
  requestId,
  data,
  refresh,
}: {
  schoolId: string;
  schoolName?: string;
  actorId: string;
  requestId: string;
  data: StaffWorkspace;
  refresh: () => Promise<void>;
}) {
  const request = data.can_review_staff_leave === true
    ? data.requests.find((item) => item.id === requestId)
    : undefined;
  useAttentionFocus(requestId);
  return (
    <OperationsShell
      active="work"
      title="Leave request"
      schoolName={schoolName}
      backTo="/work"
    >
      <div className="staff-page staff-page--teacher">
        {request ? (
          <LeaveReview
            schoolId={schoolId}
            actorId={actorId}
            data={data}
            refresh={refresh}
            focusRequestId={requestId}
            onlyRequestId={requestId}
          />
        ) : (
          <section className="staff-panel staff-profile-missing" role="alert">
            <h2>Leave request unavailable</h2>
            <p>This request was resolved, reassigned, or is no longer yours to review.</p>
            <Link className="staff-secondary" to="/work">Back to work</Link>
          </section>
        )}
      </div>
    </OperationsShell>
  );
}

function PrincipalStaffPage({
  schoolId,
  schoolName,
  data,
  refresh,
  actorId,
  includeOperationalQueues = false,
}: {
  schoolId: string;
  schoolName?: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
  actorId: string;
  includeOperationalQueues?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const focusRequestId = params.get("request");
  const focusCoverageId = params.get("coverage");
  const attentionNotificationId = params.get("attention_notification_id");
  const requestRevision = expectedRevision(params.get("request_revision"));
  const coverageRevision = expectedRevision(params.get("coverage_revision"));
  const requestedSection = includeOperationalQueues && (focusRequestId || focusCoverageId)
    ? "leave"
    : params.get("section") === "work-types" ? "roles" : params.get("section");
  const allowedSections: PrincipalSection[] = [
    "directory",
    "roles",
    "policies",
    ...(includeOperationalQueues ? ["leave" as const] : []),
  ];
  const section: PrincipalSection = allowedSections.includes(requestedSection as PrincipalSection)
    ? (requestedSection as PrincipalSection)
    : "directory";
  const pending = data.requests.filter(
    (request) => request.status === "submitted",
  );
  useAttentionFocus(focusRequestId ?? focusCoverageId);
  const coverGaps = data.coverage_tasks.filter(task => ["open", "offered", "declined"].includes(task.status)).length;
  const exactRequestAttention = Boolean(attentionNotificationId && focusRequestId && requestRevision && data.requests.some((request) =>
    request.id === focusRequestId && request.revision === requestRevision && request.status === "submitted"));
  const exactCoverageAttention = Boolean(attentionNotificationId && focusCoverageId && coverageRevision && data.coverage_tasks.some((task) =>
    task.id === focusCoverageId && task.revision === coverageRevision && ["accepted", "declined"].includes(task.status)));
  const hasFocusedAttention = Boolean(attentionNotificationId && (focusRequestId || focusCoverageId));
  const exactFocusedAttention = exactRequestAttention || exactCoverageAttention;
  return (
    <OperationsShell
      active="more"
      title="People & responsibilities"
      schoolName={schoolName}
      backTo="/more/setup"
    >
      {exactFocusedAttention ? <AttentionOpenAcknowledgement /> : null}
      {hasFocusedAttention && !exactFocusedAttention ? (
        <AttentionTargetUnavailable message="This staff request changed after the alert was created. It was not marked as opened." />
      ) : null}
      <div className="staff-page">
        <nav className="staff-tabs" aria-label="Staff management sections">
          {([
              { id: "directory", label: "People", icon: UsersRound },
              { id: "roles", label: "Roles", icon: ClipboardCheck },
              ...(includeOperationalQueues ? [{ id: "leave" as const, label: "Leave", icon: CalendarCheck2 }] : []),
              { id: "policies", label: "Leave settings", icon: Settings2 },
            ] as const).map(({ id, label, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={section === id ? "is-active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setParams({ section: id }, { replace: true })}
            >
              <Icon size={17} />
              {label}
              {id === "leave" && pending.length + coverGaps > 0 ? (
                <b aria-label={`${pending.length} leave reviews, ${coverGaps} cover gaps`}>{pending.length + coverGaps}</b>
              ) : null}
            </button>
          ))}
        </nav>
        {section === "directory" ? (
          <StaffDirectory schoolId={schoolId} data={data} refresh={refresh} />
        ) : section === "roles" ? (
          <AccessRolesPanel schoolId={schoolId} data={data} refresh={refresh} />
        ) : section === "leave" ? (
          <div className="staff-leave-layout">
            <LeaveReview schoolId={schoolId} actorId={actorId} data={data} refresh={refresh} focusRequestId={focusRequestId} />
            <CoverageBoard schoolId={schoolId} data={data} refresh={refresh} focusCoverageId={focusCoverageId} />
          </div>
        ) : (
          <PolicySettings schoolId={schoolId} data={data} refresh={refresh} />
        )}
      </div>
    </OperationsShell>
  );
}


function StaffDirectory({
  schoolId,
  data,
  refresh,
}: {
  schoolId: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [params] = useSearchParams();
  const directoryParams = staffDirectoryParams(params);
  return (
    <div className="staff-directory-layout">
      <section className="staff-panel staff-directory">
        <header>
          <div>
            <span>{data.profiles.filter(profile => profile.status === "active").length} active staff</span>
          </div>
          <div className="staff-directory-actions">
          <Link to={`/more/setup/people/invitations?from=staff&role=staff&school=${schoolId}`}>Invite staff</Link>
          <button
            type="button"
            className="staff-primary staff-compact"
            onClick={() => setAdding(true)}
          >
            <UserPlus size={17} />
            Add staff
          </button>
          </div>
        </header>
        <CollectionView items={data.profiles} namespace="staff" label="staff" searchLabel="Find staff" searchPlaceholder="Name, staff code or position" searchText={(item) => `${staffName(item)} ${item.staff_code} ${item.designation} ${item.department} ${item.email}`} categoryLabel="Staff status" categories={[
          { value: "active", label: "Active", matches: (item) => item.status === "active" },
          { value: "onboarding", label: "Onboarding", matches: (item) => item.status === "onboarding" },
          { value: "inactive", label: "Inactive", matches: (item) => item.status === "inactive" },
        ]} empty={<p className="staff-empty">No staff profiles yet.</p>}>{(visible) => <div className="staff-list">
          {visible.map((item) => {
            const items = data.onboarding_items.filter(check => check.staff_profile_id === item.id);
            const required = items.filter(check => check.required);
            const progress = required.length ? Math.round(required.filter(check => check.completed_at).length / required.length * 100) : 100;
            return (
              <Link
                to={`/more/setup/responsibilities/${item.id}?${directoryParams}`}
                key={item.id}
                aria-label={`Open ${staffName(item)} staff profile`}
              >
                <Avatar profile={item} />
                <span>
                  <strong>{staffName(item)}</strong>
                  <small>
                    {item.designation} · {item.staff_code}
                  </small>
                  {item.status === "onboarding" ? (
                    <i>
                      {items.length ? <><span style={{ width: `${progress}%` }} />{progress}% required checks complete</> : "Onboarding in progress"}
                    </i>
                  ) : null}
                </span>
                <em className={`staff-status staff-status--${item.status}`}>
                  {item.status}
                </em>
                <ChevronRight size={17} />
              </Link>
            );
          })}
        </div>}</CollectionView>
      </section>
      {adding ? (
        <NewStaffDialog
          schoolId={schoolId}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function PrincipalStaffDetailPage({
  schoolId,
  schoolName,
  data,
  profileId,
  refresh,
}: {
  schoolId: string;
  schoolName?: string;
  data: AdminStaffWorkspace;
  profileId: string;
  refresh: () => Promise<void>;
}) {
  const [params] = useSearchParams();
  const directoryHref = `/more/setup/responsibilities?${staffDirectoryParams(params)}`;
  const profile = data.profiles.find((item) => item.id === profileId);
  const focusAssignmentId = params.get("assignment") ?? undefined;
  const assignmentRevision = expectedRevision(params.get("assignment_revision"));
  const attentionNotificationId = params.get("attention_notification_id");
  const exactAssignmentAttention = Boolean(attentionNotificationId && focusAssignmentId && assignmentRevision && profile && data.assignments.some((item) =>
    item.id === focusAssignmentId && item.staff_profile_id === profile.id && item.revision === assignmentRevision
      && ["active", "declined"].includes(item.status)));

  return (
    <OperationsShell
      active="more"
      title="Staff profile"
      schoolName={schoolName}
      backTo={directoryHref}
    >
      {exactAssignmentAttention ? <AttentionOpenAcknowledgement /> : null}
      {attentionNotificationId && focusAssignmentId && !exactAssignmentAttention ? (
        <AttentionTargetUnavailable message="This assignment response changed after the alert was created. It was not marked as opened." />
      ) : null}
      <div className="staff-page staff-page--profile">
        {profile ? (
          <StaffDetail
            key={profile.id}
            schoolId={schoolId}
            profile={profile}
            workspace={data}
            items={data.onboarding_items.filter(
              (item) => item.staff_profile_id === profile.id,
            )}
            policies={data.policies}
            balances={data.balances.filter(
              (balance) => balance.staff_profile_id === profile.id,
            )}
            focusAssignmentId={focusAssignmentId}
            refresh={refresh}
          />
        ) : (
          <section className="staff-panel staff-profile-missing" role="status">
            <h2>Staff profile not found</h2>
            <p>This record may have been removed or is no longer available.</p>
            <Link className="staff-secondary" to={directoryHref}>
              Back to people
            </Link>
          </section>
        )}
      </div>
    </OperationsShell>
  );
}

function Avatar({
  profile,
}: {
  profile: Pick<StaffProfile, "first_name" | "last_name" | "avatar_url">;
}) {
  return profile.avatar_url ? (
    <img className="staff-avatar" src={profile.avatar_url} alt="" />
  ) : (
    <span className="staff-avatar staff-avatar--initials">
      {profile.first_name.charAt(0)}
      {profile.last_name.charAt(0)}
    </span>
  );
}

function StaffDetail({
  schoolId,
  profile,
  workspace,
  items,
  policies,
  balances,
  focusAssignmentId,
  refresh,
}: {
  schoolId: string;
  profile: StaffProfile;
  workspace: AdminStaffWorkspace;
  items: AdminStaffWorkspace["onboarding_items"];
  policies: LeavePolicy[];
  balances: AdminStaffWorkspace["balances"];
  focusAssignmentId?: string;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function toggle(item: AdminStaffWorkspace["onboarding_items"][number]) {
    setBusy(item.id);
    setError("");
    try {
      await updateStaffOnboarding(schoolId, profile.id, {
        item_id: item.id,
        completed: !item.completed_at,
        note: item.note,
        expected_revision: profile.revision,
      });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("adjust");
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await adjustStaffBalance(schoolId, {
        staff_profile_id: profile.id,
        policy_id: formValue(form, "policy"),
        days: Number(formValue(form, "days")),
        reason: formValue(form, "reason"),
      });
      event.currentTarget.reset();
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="staff-panel staff-detail">
      <header>
        <Avatar profile={profile} />
        <div>
          <span>{profile.staff_code}</span>
          <h2>{staffName(profile)}</h2>
          <p>
            {profile.designation}
            {profile.department ? ` · ${profile.department}` : ""}
          </p>
        </div>
        <em className={`staff-status staff-status--${profile.status}`}>
          {profile.status}
        </em>
      </header>
      <div className="staff-facts">
        <span>
          <small>Joined</small>
          <strong>{profile.joined_on ? displayDate(profile.joined_on) : "Not provided"}</strong>
        </span>
        <span>
          <small>Employment</small>
          <strong>{profile.employment_type === "unspecified" ? "Not specified" : profile.employment_type.replace("_", " ")}</strong>
        </span>
        <span>
          <small>Contact</small>
          <strong>{profile.email}</strong>
        </span>
      </div>
      <StaffRoleAssignments schoolId={schoolId} profile={profile} data={workspace} refresh={refresh} focusAssignmentId={focusAssignmentId}/>
      <StaffOnboardingChecklist
        items={items}
        personId={profile.person_id}
        busy={Boolean(busy)}
        onToggle={toggle}
      />
      <div className="staff-section-heading">
        <div>
          <span>LEAVE BALANCE</span>
          <h3>{dataYear(policies)}</h3>
        </div>
        <CalendarClock size={20} />
      </div>
      <div className="staff-mini-balances">
        {balances.map((balance) => {
          const available =
            number(balance.annual_allowance) +
            number(balance.adjustments) -
            number(balance.used);
          return (
            <div key={balance.policy_id}>
              <strong>{balance.name}</strong>
              <span>{days(available)} available</span>
              <small>
                {days(number(balance.used))} used ·{" "}
                {days(number(balance.pending))} pending
              </small>
            </div>
          );
        })}
      </div>
      {policies.length ? (
        <details className="staff-disclosure">
          <summary>
            Adjust balance <ChevronRight size={17} />
          </summary>
          <form
            onSubmit={(event) => void adjust(event)}
            className="staff-form staff-adjust-form"
          >
            <label>
              Policy
              <select name="policy" required>
                {policies
                  .filter((policy) => policy.is_active)
                  .map((policy) => (
                    <option value={policy.id} key={policy.id}>
                      {policy.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Days
              <input
                name="days"
                type="number"
                step="0.5"
                min="-366"
                max="366"
                required
              />
            </label>
            <label className="staff-span">
              Reason
              <input
                name="reason"
                minLength={8}
                maxLength={500}
                required
                placeholder="Opening balance or approved correction"
              />
            </label>
            <button className="staff-secondary" disabled={busy === "adjust"}>
              {busy === "adjust" ? "Saving…" : "Record adjustment"}
            </button>
          </form>
        </details>
      ) : null}
      {error ? (
        <p className="staff-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function StaffOnboardingChecklist({
  items,
  personId,
  busy,
  onToggle,
}: {
  items: AdminStaffWorkspace["onboarding_items"];
  personId?: string | null;
  busy: boolean;
  onToggle: (item: AdminStaffWorkspace["onboarding_items"][number]) => Promise<void>;
}) {
  if (!items.length) return null;
  const required = items.filter((item) => item.required);
  const complete = required.filter((item) => item.completed_at).length;
  const hasOptional = required.length !== items.length;
  const checklist = (
    <div className="staff-checklist">
      {items.map((item) => !item.required && item.item_key === "account_access" ? (
        <div key={item.id} className="staff-checklist-information">
          <span aria-hidden="true"><UsersRound size={16} /></span>
          <strong>{item.label}<small>Optional · Managed in People</small></strong>
          {personId ? <Link to={`/areas/people/participants/${encodeURIComponent(personId)}`}>Open in People</Link> : null}
        </div>
      ) : (
        <button
          type="button"
          key={item.id}
          disabled={busy}
          onClick={() => void onToggle(item)}
          className={item.completed_at ? "is-complete" : ""}
        >
          <span>{item.completed_at ? <Check size={16} /> : null}</span>
          <strong>{item.label}</strong>
          <small>{item.completed_at ? item.required ? "Recorded" : "Recorded · optional" : item.required ? "Required" : "Optional"}</small>
        </button>
      ))}
    </div>
  );

  if (complete === required.length) {
    return (
      <details className="staff-onboarding-complete">
        <summary>
          <span className="staff-onboarding-complete__icon">
            <FileCheck2 size={19} />
          </span>
          <span>
            <strong>{hasOptional ? "Required onboarding complete" : "Onboarding complete"}</strong>
            <small>{required.length} {hasOptional ? "required checks" : "checks"} recorded</small>
          </span>
          <ChevronRight size={18} />
        </summary>
        {checklist}
      </details>
    );
  }

  return (
    <section className="staff-onboarding-active" aria-labelledby="staff-onboarding-heading">
      <div className="staff-section-heading">
        <div>
          <span>ONBOARDING</span>
          <h3 id="staff-onboarding-heading">
            {complete} of {required.length} {hasOptional ? "required checks complete" : "complete"}
          </h3>
        </div>
        <FileCheck2 size={20} />
      </div>
      {checklist}
    </section>
  );
}

const dataYear = (policies: LeavePolicy[]) =>
  policies[0]?.academic_year ?? "Current year";

export function NewStaffDialog({
  schoolId,
  onClose,
  onSaved,
  person,
}: {
  schoolId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  person?: { id: string; label: string; revision: number };
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<string | null>(null);
  const [personCommandKey, setPersonCommandKey] = useState(() => crypto.randomUUID());
  const [personReference] = useState(() => person ? { id: person.id, expected_revision: person.revision } : undefined);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await createStaffProfile(schoolId, {
        ...(person ? { person: personReference, idempotency_key: personCommandKey } : {
          first_name: formValue(form, "first_name"), last_name: formValue(form, "last_name"),
          email: formValue(form, "email"), phone: formValue(form, "phone"),
        }),
        staff_code: formValue(form, "staff_code"),
        staff_kind: formValue(form, "staff_kind"),
        designation: formValue(form, "designation"),
        department: formValue(form, "department"),
        employment_type: formValue(form, "employment_type"),
        joined_on: formValue(form, "joined_on") || null,
      });
      if (result.invitation && !person) setInvite(result.invitation.token);
      else await onSaved();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="staff-modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-staff-title"
      >
        <header>
          <div>
            <span>{person ? person.label : "ONBOARD STAFF"}</span>
            <h2 id="new-staff-title">{person ? "Add work profile" : "Add staff member"}</h2>
            <p>{person ? "Employment details for this same person. No invitation, account access or operational permissions are created." : "Service record essentials and secure account access."}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {invite ? (
          <div className="staff-invite">
            <ShieldCheck size={28} />
            <h3>Profile created</h3>
            <p>
              Share this single-use account code privately. It expires in 30 minutes.
            </p>
            <code>{invite}</code>
            <button
              type="button"
              className="staff-secondary"
              onClick={() => void navigator.clipboard.writeText(invite)}
            >
              Copy code
            </button>
            <button
              type="button"
              className="staff-primary"
              onClick={() => void onSaved()}
            >
              Done
            </button>
          </div>
        ) : (
          <form className="staff-form" onSubmit={(event) => void submit(event)} onChange={() => { if (person) setPersonCommandKey(crypto.randomUUID()); }}>
            <div className="staff-form-grid">
              {!person ? <><label>
                First name
                <input name="first_name" required maxLength={100} />
              </label>
              <label>
                Last name
                <input name="last_name" maxLength={100} />
              </label></> : null}
              {!person ? <><label>
                Email
                <input type="email" name="email" required />
              </label>
              <label>
                Phone
                <input type="tel" name="phone" maxLength={30} />
              </label></> : null}
              <label>
                Staff code
                <input
                  name="staff_code"
                  required
                  pattern="[A-Za-z0-9][A-Za-z0-9/_-]{1,39}"
                  placeholder="T-104"
                />
              </label>
              <label>
                Position
                <input
                  name="designation"
                  required
                  minLength={2}
                  placeholder="Mathematics teacher"
                />
              </label>
              <label>
                Team
                <select name="staff_kind">
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-teaching</option>
                </select>
              </label>
              <label>
                Department
                <input name="department" placeholder="Secondary school" />
              </label>
              <label>
                Employment
                <select name="employment_type">
                  <option value="unspecified">Not specified</option>
                  <option value="full_time">Full time</option>
                  <option value="part_time">Part time</option>
                  <option value="contract">Contract</option>
                </select>
              </label>
              <label>
                Joining date
                <TemporalInput name="joined_on" type="date" />
              </label>
            </div>
            {error ? (
              <p className="staff-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer>
              <button
                type="button"
                className="staff-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button className="staff-primary" disabled={busy}>
                {busy ? "Creating…" : person ? "Save work profile" : "Create & invite"}
              </button>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}

const assignmentScope = (assignment: ResponsibilityAssignment) =>
  assignment.class_name ||
  assignment.event_title ||
  assignment.scope_label ||
  "School-wide";
const timeWindow = (startsAt: string | null, endsAt: string | null) =>
  startsAt && endsAt
    ? `${startsAt.slice(0, 5)}–${endsAt.slice(0, 5)}`
    : "All day";

function StaffCoverageWorkspace({
  schoolId,
  schoolName,
  data,
  refresh,
}: {
  schoolId: string;
  schoolName?: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
}) {
  const [params] = useSearchParams();
  const focusCoverageId = params.get("coverage");
  const attentionNotificationId = params.get("attention_notification_id");
  const coverageRevision = expectedRevision(params.get("coverage_revision"));
  const focusedCoverage = focusCoverageId
    ? data.coverage_tasks.find((item) => item.id === focusCoverageId)
    : undefined;
  const exactAttention = Boolean(
    attentionNotificationId
      && focusedCoverage
      && coverageRevision
      && focusedCoverage.revision === coverageRevision
      && ["accepted", "declined"].includes(focusedCoverage.status),
  );
  useAttentionFocus(focusCoverageId);
  return (
    <OperationsShell
      active="areas"
      title="Coverage"
      schoolName={schoolName}
      backTo="/areas/responsibilities"
    >
      {exactAttention ? <AttentionOpenAcknowledgement /> : null}
      {attentionNotificationId && focusCoverageId && !exactAttention ? (
        <AttentionTargetUnavailable message="This cover item changed after the alert was created. It was not marked as opened." />
      ) : null}
      <div className="staff-page">
        <CoverageBoard
          schoolId={schoolId}
          data={data}
          refresh={refresh}
          focusCoverageId={focusCoverageId}
        />
      </div>
    </OperationsShell>
  );
}

function StaffLeaveReviewWorkspace({
  schoolId,
  schoolName,
  actorId,
  data,
  refresh,
}: {
  schoolId: string;
  schoolName?: string;
  actorId: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
}) {
  const [params] = useSearchParams();
  const focusRequestId = params.get("request");
  const attentionNotificationId = params.get("attention_notification_id");
  const requestRevision = expectedRevision(params.get("request_revision"));
  const focusedRequest = focusRequestId
    ? data.requests.find((item) => item.id === focusRequestId)
    : undefined;
  const exactAttention = Boolean(
    attentionNotificationId
      && focusedRequest
      && requestRevision
      && focusedRequest.revision === requestRevision
      && focusedRequest.status === "submitted",
  );
  useAttentionFocus(focusRequestId);
  return (
    <OperationsShell
      active="areas"
      title="Staff leave"
      schoolName={schoolName}
      backTo="/areas/responsibilities"
    >
      {exactAttention ? <AttentionOpenAcknowledgement /> : null}
      {attentionNotificationId && focusRequestId && !exactAttention ? (
        <AttentionTargetUnavailable message="This leave request changed after the alert was created. It was not marked as opened." />
      ) : null}
      <div className="staff-page">
        <LeaveReview
          schoolId={schoolId}
          actorId={actorId}
          data={data}
          refresh={refresh}
          focusRequestId={focusRequestId}
        />
      </div>
    </OperationsShell>
  );
}



function LeaveReview({
  schoolId,
  actorId,
  data,
  refresh,
  focusRequestId,
  onlyRequestId,
}: {
  schoolId: string;
  actorId: string;
  data: StaffWorkspace;
  refresh: () => Promise<void>;
  focusRequestId?: string | null;
  onlyRequestId?: string;
}) {
  const command = useLeaveCommand(schoolId, actorId, refresh);
  const visibleRequests = onlyRequestId
    ? data.requests.filter((request) => request.id === onlyRequestId)
    : data.requests;
  const pending = visibleRequests.filter((request) => request.status === "submitted");
  const decided = visibleRequests.filter((request) => request.status !== "submitted");
  async function decide(
    request: StaffLeaveRequest,
    decision: "approved" | "rejected",
    note: string,
  ) {
    const input = {
      decision,
      note: note.trim(),
      expected_revision: request.revision,
    } as const;
    await command.run({
      operation: "decide",
      targetId: request.id,
      material: input,
      execute: (commandId) => decideStaffLeave(schoolId, request.id, {
        ...input,
        command_id: commandId,
      }),
      acceptedMessage: "The decision was saved.",
    });
  }
  async function reroute(request: StaffLeaveRequest) {
    await command.run({
      operation: "reroute",
      targetId: request.id,
      material: { expected_revision: request.revision },
      execute: (commandId) => rerouteStaffLeave(schoolId, request.id, { expected_revision: request.revision, command_id: commandId }),
      acceptedMessage: "The request was sent to the current reviewer.",
    });
  }
  return (
    <section className="staff-panel staff-leave-queue">
      <header>
        <h2>Leave requests</h2>
        <b>{pending.length} pending</b>
      </header>
      {data.mode === "admin" && !data.policies.some(policy => policy.is_active) ? <LeavePolicyReadinessNotice canConfigure /> : null}
      {data.leave_review_readiness?.state !== "ready" ? <LeaveReviewReadinessNotice schoolId={schoolId} readiness={data.leave_review_readiness} command={command} /> : null}
      <LeaveCommandFeedback command={command} />
      <div className="staff-request-list">
        {pending.map((request) => (
          <LeaveRequestCard
            key={request.id}
            request={request}
            balance={data.balances.find(
              (balance) =>
                balance.staff_profile_id === request.staff_profile_id &&
                balance.policy_id === request.policy_id,
            )}
            busy={command.busy === request.id}
            disabled={command.blocked}
            reviewReady={!data.leave_review_readiness || data.leave_review_readiness.state === "ready"}
            actorId={actorId}
            focused={request.id === focusRequestId}
            onDecide={decide}
            onReroute={reroute}
            schoolId={schoolId}
          />
        ))}
        {!pending.length ? (
          <p className="staff-empty staff-empty--compact">
            <Check size={17} /> No requests need review.
          </p>
        ) : null}
        {decided.map((request) => (
          <DecidedLeaveRequest
            key={request.id}
            request={request}
            focused={request.id === focusRequestId}
            coverManagement={data.mode === "admin" ? "admin" : "handoff"}
            coverage={data.mode === "admin" ? { schoolId, data, refresh } : undefined}
          />
        ))}
      </div>
    </section>
  );
}

function LeaveRequestWork({ request, schoolId }: { request: StaffLeaveRequest; schoolId: string }) {
  const environment = useOptionalExecutionEnvironment();
  const worldKey = environment?.mode === "simulation" ? `${environment.namespaceId}:${environment.runId}` : "live";
  const key = `${worldKey}:${schoolId}:${request.id}:${request.revision}`;
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: StaffLeaveImpact; error?: string } | null>(null);
  useEffect(() => {
    if (!open || request.affected_work) return;
    let current = true;
    void getStaffWorkspace(schoolId, request.id).then(workspace => {
      const latest = workspace.requests.find(item => item.id === request.id);
      if (!current) return;
      if (latest?.revision !== request.revision || latest.status !== "submitted") setResult({ key, error: "This request changed. Refresh requests before deciding." });
      else if (!latest.affected_work) setResult({ key, error: "The activity preview is unavailable for these dates." });
      else setResult({ key, data: latest.affected_work });
    }).catch(() => { if (current) setResult({ key, error: "Couldn’t load affected activities." }); });
    return () => { current = false; };
  }, [open, key, retry, schoolId, request.id, request.revision, request.affected_work]);
  const current = result?.key === key ? result : null;
  const impact = request.affected_work ?? current?.data;
  const pageCount = Math.max(1, Math.ceil((impact?.items.length ?? 0) / 4));
  const currentPage = Math.min(page, pageCount - 1);
  return <details className="staff-request-work" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>View affected activities</summary>
    {open ? impact ? <>
      {impact.items.length ? <ul>{impact.items.slice(currentPage * 4, (currentPage + 1) * 4).map(item => <li key={item.id}>
        <strong>{item.title}</strong><span>{[displayDate(item.date), item.starts_at && item.ends_at ? `${item.starts_at.slice(0, 5)}–${item.ends_at.slice(0, 5)}` : "Time not specified", item.class_label, item.location].filter(Boolean).join(" · ")}</span>
      </li>)}</ul> : <p>No published classes or dated duties found.</p>}
      {pageCount > 1 ? <nav aria-label="Request activity pages"><button type="button" className="staff-secondary" disabled={currentPage === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>{currentPage + 1} of {pageCount}</span><button type="button" className="staff-secondary" disabled={currentPage === pageCount - 1} onClick={() => setPage(value => value + 1)}>Next</button></nav> : null}
      {impact.truncated ? <p>Showing {impact.items.length} of {impact.total} activities.</p> : null}
      <p className="staff-scope-note">Planned work · checked again on approval</p>
    </> : current?.error ? <div role="alert"><p>{current.error}</p><button type="button" className="staff-secondary" onClick={() => { setResult(null); setRetry(value => value + 1); }}>Retry preview</button></div> : <p role="status">Loading affected activities…</p> : null}
  </details>;
}

function LeaveRequestCard({
  request,
  balance,
  busy,
  disabled,
  reviewReady,
  actorId,
  focused = false,
  onDecide,
  onReroute,
  schoolId,
}: {
  request: StaffLeaveRequest;
  balance?: LeaveBalance;
  busy: boolean;
  disabled: boolean;
  reviewReady: boolean;
  actorId: string;
  focused?: boolean;
  onDecide: (
    request: StaffLeaveRequest,
    decision: "approved" | "rejected",
    note: string,
  ) => Promise<void>;
  onReroute: (request: StaffLeaveRequest) => Promise<void>;
  schoolId: string;
}) {
  const [note, setNote] = useState("");
  const [declining, setDeclining] = useState(false);
  const route = request.review_route;
  const mayDecide = reviewReady && (!route || route.state === "current" && route.reviewer?.user_id === actorId);
  const workCount = leaveWorkCount(request);
  const available = balance
    ? number(balance.annual_allowance) +
      number(balance.adjustments) -
      number(balance.used)
    : 0;
  const coverageDecision = request.status !== "approved"
    ? "need coverage if approved"
    : (request.coverage_open ?? 0) > 0
      ? `${request.coverage_open} still need cover`
      : (request.coverage_fallback ?? 0) > 0
        ? `Fallback · ${request.coverage_fallback_labels || "School policy"}`
        : (request.coverage_filled ?? 0) > 0
          ? `${request.coverage_filled} covered`
          : "No cover required";
  return (
    <article id={`attention-${request.id}`} tabIndex={-1} className={`staff-request staff-request--${request.status}${focused ? " attention-focus" : ""}`}>
      <header>
        <span className="staff-request__avatar">
          {request.first_name.charAt(0)}
          {request.last_name.charAt(0)}
        </span>
        <div>
          <strong>
            {request.first_name} {request.last_name}
          </strong>
          <small>
            {request.designation} · {request.policy_name}
          </small>
        </div>
        <em className={`staff-status staff-status--${request.status}`}>
          {request.status === "submitted" ? "Pending" : request.status}
        </em>
      </header>
      <div className="staff-request__dates">
        <span>
          <small>DATES</small>
          <strong>
            {displayDate(request.starts_on)}
            {request.ends_on !== request.starts_on
              ? ` – ${displayDate(request.ends_on)}`
              : ""}
          </strong>
        </span>
        <span>
          <small>REQUEST</small>
          <strong>
            {days(number(request.requested_days))} day
            {number(request.requested_days) === 1 ? "" : "s"}
          </strong>
        </span>
      </div>
      <div className="staff-impact">
        <span>
          <CalendarClock size={17} />
          <strong>
            {workCount} {workCount === 1 ? "class or shift" : "classes or shifts"}
          </strong>{" "}
          {coverageDecision}
        </span>
        {balance ? <span>
          <Scale size={17} />
          <strong>{days(available)} days</strong> available before decision
        </span> : null}
      </div>
      <p>{request.reason}</p>
      <LeaveRequestWork request={request} schoolId={schoolId} />
      <LeaveReviewRouteSummary request={request} />
      {request.handover_note ? (
        <small className="staff-handover">
          Handover: {request.handover_note}
        </small>
      ) : null}
      {request.status === "submitted" && route?.can_reroute && route.state !== "current" ? <button
        type="button"
        className="staff-primary staff-route-action"
        disabled={disabled}
        onClick={() => void onReroute(request)}
      >{busy ? "Sending…" : route.current_reviewer?.user_id === actorId ? "Take over review" : "Send to current reviewer"}</button> : null}
      {request.status === "submitted" && mayDecide ? (
        <div className="staff-decision staff-decision--simple">
          {declining ? <label className="staff-decline-reason">Reason for declining
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Tell the requester why"
            maxLength={1000}
            rows={2}
            autoFocus
            disabled={disabled}
          /></label> : null}
          <button
            type="button"
            className="staff-secondary"
            disabled={disabled}
            onClick={() => { setDeclining(value => !value); setNote(""); }}
          >
            {declining ? "Back" : "Decline"}
          </button>
          <button
            type="button"
            className="staff-primary"
            disabled={disabled || declining && !note.trim()}
            onClick={() => void onDecide(request, declining ? "rejected" : "approved", declining ? note : "")}
          >
            {busy ? "Saving…" : declining ? "Decline request" : "Approve"}
          </button>
        </div>
      ) : request.decision_note ? (
        <small className="staff-handover">
          Decision: {request.decision_note}
        </small>
      ) : null}
    </article>
  );
}

function DecidedLeaveRequest({
  request,
  focused = false,
  personal = false,
  coverManagement,
  coverage,
}: {
  request: StaffLeaveRequest;
  focused?: boolean;
  personal?: boolean;
  coverManagement?: "admin" | "handoff";
  coverage?: { schoolId: string; data: AdminStaffWorkspace; refresh: () => Promise<void> };
}) {
  const workCount = leaveWorkCount(request);
  const coverageDecision = request.status === "approved"
    ? (request.coverage_open ?? 0) > 0
      ? `${request.coverage_open} still need cover`
      : (request.coverage_fallback ?? 0) > 0
        ? `Fallback · ${request.coverage_fallback_labels || "School policy"}`
        : (request.coverage_filled ?? 0) > 0
          ? `${request.coverage_filled} covered`
          : "No cover required"
    : null;
  return (
    <details
      id={`attention-${request.id}`}
      tabIndex={-1}
      className={`staff-request staff-request--decided staff-request--${request.status}${focused ? " attention-focus" : ""}`}
      open={focused || coverManagement === "admin" && (request.coverage_open ?? 0) > 0 || undefined}
    >
      <summary>
        <span className="staff-request__avatar">
          {personal ? <CalendarClock size={18} aria-hidden="true" /> : <>{request.first_name.charAt(0)}{request.last_name.charAt(0)}</>}
        </span>
        <span className="staff-request__summary-copy">
          <strong>{personal ? request.policy_name : `${request.first_name} ${request.last_name}`}</strong>
          <small>
            {displayDate(request.starts_on)}
            {request.ends_on !== request.starts_on ? ` – ${displayDate(request.ends_on)}` : ""}
            {!personal ? ` · ${request.policy_name}` : ""}
          </small>
          {request.status === "approved" && (request.coverage_open ?? 0) > 0 ? <small className="staff-cover-needed">{request.coverage_open} {(request.coverage_open ?? 0) === 1 ? "activity needs" : "activities need"} cover</small> : null}
        </span>
        <em className={`staff-status staff-status--${request.status}`}>{request.status}</em>
        <ChevronRight size={18} aria-hidden="true" />
      </summary>
      <div className="staff-request__decision-details">
        <div className="staff-impact">
          <span><strong>{days(number(request.requested_days))} day{number(request.requested_days) === 1 ? "" : "s"}</strong> requested</span>
          <span>
            <CalendarClock size={17} />
            <strong>{workCount} {workCount === 1 ? "class or shift" : "classes or shifts"}</strong>
            {coverageDecision ? ` ${coverageDecision}` : ""}
          </span>
        </div>
        <p>{request.reason}</p>
        {request.decision_note ? (
          <small className="staff-handover">Decision: {request.decision_note}</small>
        ) : null}
        {request.status === "approved" && coverage && workCount > 0 ? <CoverageBoard {...coverage} leaveRequestId={request.id} embedded /> : null}
        {request.status === "approved" && (request.coverage_open ?? 0) > 0 ? coverManagement === "admin"
          ? null
          : coverManagement === "handoff" ? <p className="staff-handover">Ask a campus administrator to arrange the remaining cover.</p> : null
          : null}
      </div>
    </details>
  );
}

function PolicySettings({
  schoolId,
  data,
  refresh,
}: {
  schoolId: string;
  data: AdminStaffWorkspace;
  refresh: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<LeavePolicy | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const save = async (input: Record<string, unknown>, id?: string) => {
    setError("");
    try {
      await saveLeavePolicy(schoolId, input, id);
      setEditing(null);
      setCreating(false);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <section className="staff-panel staff-policies">
      <header>
        <div>
          <span>LEAVE SETTINGS</span>
          <h2>{data.academic_year || "Current year"} policies</h2>
          <p>
            School-configured allowances. Confirm statutory requirements
            locally.
          </p>
        </div>
        <button
          type="button"
          className="staff-primary staff-compact"
          onClick={() => setCreating(true)}
        >
          <Plus size={17} />
          Add policy
        </button>
      </header>
      <Link className="staff-secondary" to={`/more/setup/institution/operating-rules?school=${schoolId}&rule=coverage`}>Automatic cover operating rules <ChevronRight size={16}/></Link>
      <div className="staff-policy-list">
        {data.policies.map((policy) => (
          <button
            type="button"
            key={policy.id}
            onClick={() => setEditing(policy)}
          >
            <span className="staff-policy-icon">
              {policy.is_statutory ? (
                <Scale size={19} />
              ) : (
                <CalendarCheck2 size={19} />
              )}
            </span>
            <span>
              <strong>{policy.name}</strong>
              <small>
                {policy.code} · {policy.is_paid ? "Paid" : "Unpaid"}
                {policy.is_statutory ? " · Statutory" : ""}
              </small>
            </span>
            <b>
              {days(number(policy.annual_allowance))}
              <small>days/year</small>
            </b>
            <ChevronRight size={18} />
          </button>
        ))}
      </div>
      <aside className="staff-scope-note">
        <CircleDollarSign size={19} />
        <span>
          <strong>No payroll in this module.</strong> It records onboarding,
          entitlement settings, leave decisions and cover impact only.
        </span>
      </aside>
      {error ? (
        <p className="staff-error" role="alert">
          {error}
        </p>
      ) : null}
      {editing || creating ? (
        <PolicyDialog
          year={data.academic_year}
          policy={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSave={save}
        />
      ) : null}
    </section>
  );
}

function PolicyDialog({
  year,
  policy,
  onClose,
  onSave,
}: {
  year: string;
  policy: LeavePolicy | null;
  onClose: () => void;
  onSave: (input: Record<string, unknown>, id?: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    await onSave(
      {
        academic_year: year,
        code: formValue(form, "code"),
        name: formValue(form, "name"),
        annual_allowance: Number(formValue(form, "annual_allowance")),
        carry_forward_limit: Number(formValue(form, "carry_forward_limit")),
        requires_document_after_days: formValue(
          form,
          "requires_document_after_days",
        )
          ? Number(formValue(form, "requires_document_after_days"))
          : null,
        is_paid: form.has("is_paid"),
        is_statutory: form.has("is_statutory"),
        is_active: form.has("is_active"),
        ...(policy ? { expected_revision: policy.revision } : {}),
      },
      policy?.id,
    );
    setBusy(false);
  }
  return (
    <div className="staff-modal">
      <section role="dialog" aria-modal="true" aria-labelledby="policy-title">
        <header>
          <div>
            <span>LEAVE POLICY</span>
            <h2 id="policy-title">{policy ? "Edit policy" : "Add policy"}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <form className="staff-form" onSubmit={(event) => void submit(event)}>
          <div className="staff-form-grid">
            <label>
              Code
              <input
                name="code"
                defaultValue={policy?.code}
                readOnly={Boolean(policy)}
                required
              />
            </label>
            <label>
              Name
              <input name="name" defaultValue={policy?.name} required />
            </label>
            <label>
              Days per year
              <input
                name="annual_allowance"
                type="number"
                step="0.5"
                min="0"
                max="366"
                defaultValue={policy?.annual_allowance ?? "0"}
                required
              />
            </label>
            <label>
              Carry-forward cap
              <input
                name="carry_forward_limit"
                type="number"
                step="0.5"
                min="0"
                max="366"
                defaultValue={policy?.carry_forward_limit ?? "0"}
                required
              />
            </label>
            <label>
              Document after days
              <input
                name="requires_document_after_days"
                type="number"
                step="0.5"
                min="0.5"
                max="366"
                defaultValue={policy?.requires_document_after_days ?? ""}
              />
            </label>
          </div>
          <div className="staff-check-row">
            <label>
              <input
                type="checkbox"
                name="is_paid"
                defaultChecked={policy?.is_paid ?? true}
              />{" "}
              Paid leave
            </label>
            <label>
              <input
                type="checkbox"
                name="is_statutory"
                defaultChecked={policy?.is_statutory ?? false}
              />{" "}
              Statutory category
            </label>
            <label>
              <input
                type="checkbox"
                name="is_active"
                defaultChecked={policy?.is_active ?? true}
              />{" "}
              Available to staff
            </label>
          </div>
          <footer>
            <button type="button" className="staff-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="staff-primary" disabled={busy}>
              {busy ? "Saving…" : "Save policy"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function TeacherResponsibilitiesPage({
  surface = "responsibilities",
  schoolId,
  schoolName,
  data,
  refresh,
  actorId,
}: {
  surface?: "responsibilities" | "coverage";
  schoolId: string;
  schoolName?: string;
  data: TeacherStaffWorkspace;
  refresh: () => Promise<void>;
  actorId: string;
}) {
  const [params] = useSearchParams();
  const focusAssignmentId = params.get("assignment");
  const focusCoverageId = params.get("coverage");
  const attentionNotificationId = params.get("attention_notification_id");
  const assignmentRevision = expectedRevision(params.get("assignment_revision"));
  const coverageRevision = expectedRevision(params.get("coverage_revision"));
  useAttentionFocus(focusAssignmentId ?? focusCoverageId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const showAssignments = surface === "responsibilities";
  const showCoverage = surface === "coverage";
  const assignments = showAssignments
    ? data.assignments.filter((item) => ["offered", "active"].includes(item.status))
    : [];
  const focusedAssignment = showAssignments && focusAssignmentId
    ? data.assignments.find((item) => item.id === focusAssignmentId)
    : undefined;
  const resolvedFocusedAssignment = focusedAssignment && !assignments.some((item) => item.id === focusedAssignment.id)
    ? focusedAssignment
    : undefined;
  const exactAssignmentAttention = Boolean(attentionNotificationId && focusedAssignment && assignmentRevision
    && focusedAssignment.revision === assignmentRevision && ["offered", "revoked"].includes(focusedAssignment.status));
  const focusedCoverage = showCoverage && focusCoverageId ? data.coverage_tasks.find((item) => item.id === focusCoverageId) : undefined;
  const exactCoverageAttention = Boolean(attentionNotificationId && focusedCoverage && coverageRevision
    && focusedCoverage.revision === coverageRevision && focusedCoverage.status === "offered"
    && focusedCoverage.replacement_staff_profile_id === data.profile.id);
  const hasFocusedAttention = Boolean(attentionNotificationId && (focusAssignmentId || focusCoverageId));
  const exactFocusedAttention = exactAssignmentAttention || exactCoverageAttention;
  const roleAssignments = showAssignments ? (data.role_assignments ?? []) : [];
  const activeRoleAssignments = roleAssignments.filter((item) => ["active","scheduled"].includes(item.display_status));
  const projectedIds = new Set(activeRoleAssignments.filter((item) => item.source_kind === "assignment").map((item) => item.source_id));
  const allProjectedIds = new Set(roleAssignments.filter((item) => item.source_kind === "assignment").map((item) => item.source_id));
  const pastAssignments = showAssignments
    ? data.assignments.filter((item) => ["declined", "completed", "revoked"].includes(item.status) && !allProjectedIds.has(item.id) && item.id !== focusAssignmentId)
    : [];
  const activeWorkCount = assignments.filter((item) => item.status === "active" && !projectedIds.has(item.id)).length + activeRoleAssignments.length;
  const cover = showCoverage
    ? data.coverage_tasks.filter(
        (task) =>
          task.replacement_staff_profile_id === data.profile.id &&
          ["offered", "accepted"].includes(task.status),
      )
    : [];
  const pastCover = showCoverage
    ? data.coverage_tasks.filter(
        (task) => task.replacement_staff_profile_id === data.profile.id
          && ["declined", "completed", "cancelled", "fallback_applied", "expired_unconfirmed"].includes(task.status),
      )
    : [];
  const needsReply =
    assignments.filter((item) => item.status === "offered").length +
    cover.filter((item) => item.status === "offered").length;
  async function answerAssignment(
    item: ResponsibilityAssignment,
    decision: "accepted" | "declined",
    note: string,
  ) {
    setBusy(item.id);
    setError("");
    try {
      await respondResponsibility(schoolId, item.id, {
        decision,
        note,
        expected_revision: item.revision,
      });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function answerCover(
    item: CoverageTask,
    decision: "accepted" | "declined",
    note: string,
  ) {
    setBusy(item.id);
    setError("");
    const material = {
      decision,
      note,
      expected_revision: item.revision,
    };
    const commandScope: StaffCoverageCommandScope = {
      schoolId,
      actorId,
      targetId: item.id,
    };
    let command: Awaited<ReturnType<typeof pendingStaffCoverageCommand>> | undefined;
    try {
      command = await pendingStaffCoverageCommand(commandScope, material);
      await respondCoverage(schoolId, item.id, {
        ...material,
        command_id: command.commandId,
      });
      clearPendingStaffCoverageCommand(commandScope, command);
      try {
        await refresh();
      } catch {
        setError("Your response was saved, but the latest cover status could not be loaded. Refresh this page before responding again.");
      }
    } catch (cause) {
      if (command && isDefinitiveStaffCoverageFailure(cause)) {
        clearPendingStaffCoverageCommand(commandScope, command);
      }
      setError((cause as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <OperationsShell
      active="areas"
      title={surface === "coverage" ? "Coverage" : "Responsibilities"}
      schoolName={schoolName}
      backTo="/areas/responsibilities"
    >
      {exactFocusedAttention ? <AttentionOpenAcknowledgement /> : null}
      {hasFocusedAttention && !exactFocusedAttention ? (
        <AttentionTargetUnavailable message="This work item changed after the alert was created. It was not marked as opened." />
      ) : null}
      <div className="staff-page staff-page--teacher">
        <div className="staff-inline-summary">
            <span>
              {activeWorkCount +
                cover.filter((item) => item.status === "accepted").length}{" "}
              {surface === "coverage" ? "current cover duties" : "current assignments"}
            </span>
            {needsReply ? <span>
              {needsReply
                ? `${needsReply} ${needsReply === 1 ? "offer needs" : "offers need"} your response`
                : "Nothing is waiting for your response"}
            </span> : null}
        </div>
        {error ? (
          <p className="staff-error" role="alert">
            {error}
          </p>
        ) : null}
        {focusAssignmentId && !focusedAssignment ? (
          <section className="staff-assignment-attention-state" role="alert">
            <strong>Assignment unavailable</strong>
            <p>This assignment no longer belongs to your current staff profile.</p>
          </section>
        ) : null}
        {resolvedFocusedAssignment ? (
          <section className="staff-panel staff-my-duties">
            <div className="staff-response-list">
              <article id={`attention-${resolvedFocusedAssignment.id}`} tabIndex={-1} className="attention-focus">
                <span className={`staff-duty-icon staff-duty-icon--${resolvedFocusedAssignment.status}`}>
                  <Handshake size={18} />
                </span>
                <div>
                  <strong>{resolvedFocusedAssignment.type_name}</strong>
                  <small>{assignmentScope(resolvedFocusedAssignment)} · {displayDate(resolvedFocusedAssignment.starts_on)}</small>
                  <p>{resolvedFocusedAssignment.revocation_reason || resolvedFocusedAssignment.response_note || `This assignment is ${resolvedFocusedAssignment.status}.`}</p>
                  <em className={`staff-status staff-status--${resolvedFocusedAssignment.status}`}>{resolvedFocusedAssignment.status}</em>
                </div>
              </article>
            </div>
          </section>
        ) : null}
        {needsReply ? (
          <section className="staff-panel staff-my-duties">
            <header>
              <div>
                <span>NEEDS YOUR RESPONSE</span>
                <h2>Review work offers</h2>
                <p>Accept only when the scope and timing are clear.</p>
              </div>
              <b>{needsReply}</b>
            </header>
            <div className="staff-response-list">
              {assignments
                .filter((item) => item.status === "offered")
                .map((item) => (
                  <TeacherDutyResponse
                    key={item.id}
                    title={item.type_name}
                    subtitle={`${assignmentScope(item)} · ${displayDate(item.starts_on)}`}
                    detail={item.notes || item.access_summary}
                    busy={busy === item.id}
                    sourceId={item.id}
                    focused={item.id === focusAssignmentId}
                    onAnswer={(decision, note) =>
                      answerAssignment(item, decision, note)
                    }
                  />
                ))}
              {cover
                .filter((item) => item.status === "offered")
                .map((item) => (
                  <TeacherDutyResponse
                    key={item.id}
                    title={`Cover · ${item.title}`}
                    subtitle={`${displayDate(item.duty_date)} · ${timeWindow(item.starts_at, item.ends_at)}${item.class_name ? ` · ${item.class_name}` : ""}`}
                    detail={`${item.absent_first_name} ${item.absent_last_name} is away${item.handover_note ? ` · ${item.handover_note}` : ""}`}
                    busy={busy === item.id}
                    sourceId={item.id}
                    focused={item.id === focusCoverageId}
                    onAnswer={(decision, note) =>
                      answerCover(item, decision, note)
                    }
                  />
                ))}
            </div>
          </section>
        ) : null}
        <section className="staff-panel staff-my-duties">
          <header>
            <div>
              <span>CURRENT</span>
              <h2>{surface === "coverage" ? "Accepted cover" : "Assignments"}</h2>
            </div>
            <BadgeCheck size={21} />
          </header>
          <MyRoleAssignments assignments={roleAssignments}/>
          <div className="staff-assignment-list">
            {assignments
              .filter((item) => item.status === "active" && !projectedIds.has(item.id))
              .map((item) => (
                <article className="staff-assignment-card" key={item.id}>
                  <span
                    className={`staff-duty-icon staff-duty-icon--${item.category}`}
                  >
                    <Handshake size={18} />
                  </span>
                  <div className="staff-assignment-card__main">
                    <header>
                      <div>
                        <strong>{item.type_name}</strong>
                        <small>
                          {assignmentScope(item)}
                          {item.subject_name ? ` · ${item.subject_name}` : ""}
                        </small>
                      </div>
                      <em className="staff-status staff-status--active">
                        active
                      </em>
                    </header>
                    <div className="staff-duty-meta">
                      <span>
                        <CalendarClock size={14} />
                        {displayDate(item.starts_on)}
                        {item.ends_on
                          ? ` – ${displayDate(item.ends_on)}`
                          : " · ongoing"}
                      </span>
                      {item.location ? (
                        <span>
                          <MapPin size={14} />
                          {item.location}
                        </span>
                      ) : null}
                    </div>
                    <p>{item.notes || item.access_summary}</p>
                  </div>
                </article>
              ))}
            {cover
              .filter((item) => item.status === "accepted")
              .map((item) => (
                <article className="staff-assignment-card" key={item.id}>
                  <span className="staff-duty-icon staff-duty-icon--operations">
                    <RotateCcw size={18} />
                  </span>
                  <div className="staff-assignment-card__main">
                    <header>
                      <div>
                        <strong>Cover · {item.title}</strong>
                        <small>
                          {item.class_name}
                          {item.subject_name ? ` · ${item.subject_name}` : ""}
                        </small>
                      </div>
                      <em className="staff-status staff-status--active">
                        accepted
                      </em>
                    </header>
                    <div className="staff-duty-meta">
                      <span>
                        <CalendarClock size={14} />
                        {displayDate(item.duty_date)} ·{" "}
                        {timeWindow(item.starts_at, item.ends_at)}
                      </span>
                      {item.location ? (
                        <span>
                          <MapPin size={14} />
                          {item.location}
                        </span>
                      ) : null}
                    </div>
                    {item.handover_note ? <p>{item.handover_note}</p> : null}
                  </div>
                </article>
              ))}
            {activeWorkCount === 0 &&
            !cover.some((item) => item.status === "accepted") ? (
              <p className="staff-empty">{surface === "coverage" ? "No accepted cover duties." : "No current work assignments."}</p>
            ) : null}
          </div>
        </section>
        {pastAssignments.length || pastCover.length ? (
          <details className="staff-panel staff-my-duties staff-history">
            <summary>History <span>{pastAssignments.length + pastCover.length}</span></summary>
            <div className="staff-assignment-list">
              {pastAssignments.map((item) => (
                <article className="staff-assignment-card" key={item.id}>
                  <span className={`staff-duty-icon staff-duty-icon--${item.status}`}><Handshake size={18} /></span>
                  <div className="staff-assignment-card__main">
                    <header><div><strong>{item.type_name}</strong><small>{assignmentScope(item)}</small></div><em className={`staff-status staff-status--${item.status}`}>{item.status}</em></header>
                    <div className="staff-duty-meta"><span><CalendarClock size={14} />{displayDate(item.starts_on)}{item.ends_on ? ` – ${displayDate(item.ends_on)}` : ""}</span></div>
                    {item.revocation_reason || item.response_note ? <p>{item.revocation_reason || item.response_note}</p> : null}
                  </div>
                </article>
              ))}
              {pastCover.map((item) => (
                <article className="staff-assignment-card" key={item.id}>
                  <span className={`staff-duty-icon staff-duty-icon--${item.status}`}><RotateCcw size={18} /></span>
                  <div className="staff-assignment-card__main">
                    <header><div><strong>Cover · {item.title}</strong><small>{item.class_name}{item.subject_name ? ` · ${item.subject_name}` : ""}</small></div><em className={`staff-status staff-status--${item.status}`}>{item.status.replaceAll("_", " ")}</em></header>
                    <div className="staff-duty-meta"><span><CalendarClock size={14} />{displayDate(item.duty_date)} · {timeWindow(item.starts_at, item.ends_at)}</span></div>
                    {item.response_note || item.handover_note ? <p>{item.response_note || item.handover_note}</p> : null}
                  </div>
                </article>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </OperationsShell>
  );
}

function TeacherDutyResponse({
  title,
  subtitle,
  detail,
  busy,
  sourceId,
  focused = false,
  onAnswer,
}: {
  title: string;
  subtitle: string;
  detail: string;
  busy: boolean;
  sourceId: string;
  focused?: boolean;
  onAnswer: (decision: "accepted" | "declined", note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <article id={`attention-${sourceId}`} tabIndex={-1} className={focused ? "attention-focus" : undefined}>
      <span className="staff-duty-icon staff-duty-icon--offered">
        <CalendarClock size={18} />
      </span>
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
        <p>{detail}</p>
        <textarea
          aria-label={`Response note for ${title}`}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
          placeholder="Optional note; required if declining"
        />
        <footer>
          <button
            type="button"
            className="staff-secondary staff-danger"
            disabled={busy || note.trim().length < 4}
            onClick={() => void onAnswer("declined", note)}
          >
            Decline
          </button>
          <button
            type="button"
            className="staff-primary"
            disabled={busy}
            onClick={() => void onAnswer("accepted", note)}
          >
            {busy ? "Saving…" : "Accept"}
          </button>
        </footer>
      </div>
    </article>
  );
}

function TeacherLeavePage({
  schoolId,
  schoolName,
  data,
  refresh,
  actorId,
}: {
  schoolId: string;
  schoolName?: string;
  data: TeacherStaffWorkspace;
  refresh: () => Promise<void>;
  actorId: string;
}) {
  const navigate=useNavigate();
  const [params,setParams]=useSearchParams();
  const focusRequestId=params.get('request');
  const requestRevision=expectedRevision(params.get('request_revision'));
  const attentionNotificationId=params.get('attention_notification_id');
  const open=params.get('create')==='leave';
  const canReview = data.can_review_staff_leave === true;
  const view=params.get('view')==='review'&&canReview?'review':'requests';
  const listParams=new URLSearchParams(params);listParams.delete('create');
  const listQuery=listParams.toString();
  const listPath=`/areas/responsibilities/leave${listQuery?`?${listQuery}`:''}`;
  const setOpen=(next:boolean)=>{
    if(next){
      setParams(current=>{const query=new URLSearchParams(current);query.set('create','leave');return query;});
      return;
    }
    const previous=previousPortalLocation(browserHistoryIndex());
    if(samePortalHref(previous,listPath)){void navigate(-1);return;}
    void navigate(listPath,{replace:true});
  };
  const sectionPath=(next:string)=>{const query=new URLSearchParams(listParams);query.set('view',next);return `/areas/responsibilities/leave?${query}`;};
  const command = useLeaveCommand(schoolId, actorId, refresh);
  const readiness = data.leave_review_readiness;
  const reviewUnavailable = Boolean(readiness && readiness.state !== "ready");
  const [leaveDraft, setLeaveDraft] = useState({ policy_id: "", starts_on: "", ends_on: "", portion: "full_day" as StaffLeaveImpactInput["portion"] });
  const policyId = leaveDraft.policy_id || data.balances[0]?.policy_id || "";
  const hasPolicy = data.balances.length > 0;
  useAttentionFocus(focusRequestId);
  const personalRequests = data.requests.filter((request) => request.staff_profile_id === data.profile.id);
  const exactRequestAttention=Boolean(attentionNotificationId&&focusRequestId&&requestRevision&&personalRequests.some((request)=>
    request.id===focusRequestId&&request.revision===requestRevision&&["approved","rejected"].includes(request.status)));
  const selectedBalance = data.balances.find(balance => balance.policy_id === policyId);
  const available = selectedBalance ? number(selectedBalance.annual_allowance) + number(selectedBalance.adjustments) - number(selectedBalance.used) - number(selectedBalance.pending) : 0;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reviewUnavailable || !hasPolicy || command.blocked) return;
    const form = new FormData(event.currentTarget);
    const input = {
      policy_id: formValue(form, "policy_id"),
      starts_on: formValue(form, "starts_on"),
      ends_on: formValue(form, "ends_on"),
      portion: formValue(form, "portion"),
      reason: formValue(form, "reason"),
      handover_note: formValue(form, "handover_note"),
    };
    await command.run({
      operation: "submit",
      targetId: "new-request",
      material: input,
      execute: (commandId) => submitStaffLeave(schoolId, {
        ...input,
        command_id: commandId,
      }),
      acceptedMessage: "Your leave request was submitted.",
      onAccepted: () => { setLeaveDraft({ policy_id: "", starts_on: "", ends_on: "", portion: "full_day" }); setOpen(false); },
    });
  }
  async function withdraw(request: StaffLeaveRequest) {
    await command.run({
      operation: "withdraw",
      targetId: request.id,
      material: { expected_revision: request.revision },
      execute: (commandId) => withdrawStaffLeave(schoolId, request.id, request.revision, commandId),
      acceptedMessage: "The request was withdrawn.",
    });
  }
  async function reroute(request: StaffLeaveRequest) {
    await command.run({
      operation: "reroute",
      targetId: request.id,
      material: { expected_revision: request.revision },
      execute: (commandId) => rerouteStaffLeave(schoolId, request.id, { expected_revision: request.revision, command_id: commandId }),
      acceptedMessage: "The request was sent to the current reviewer.",
    });
  }
  return (
    <OperationsShell
      active="areas"
      title={open?'Apply for leave':view==='review'?'Staff leave':'My leave'}
      schoolName={schoolName}
      backTo={open?listPath:'/areas/responsibilities'}
    >
      {exactRequestAttention ? <AttentionOpenAcknowledgement /> : null}
      {attentionNotificationId&&focusRequestId&&!exactRequestAttention?<AttentionTargetUnavailable message="This leave decision changed after the alert was created. It was not marked as opened."/>:null}
      <div className="staff-page staff-page--teacher">
        {!open?<><div className="staff-inline-summary">
          <span>{view==='review'?"Requests for your decision":data.academic_year || "Current year"}</span>
          {view !== 'review' ? <button className="staff-primary staff-compact" type="button" disabled={command.blocked} onClick={() => setOpen(!open)}>
            <Plus size={18} />
            Apply for leave
          </button> : null}
        </div>{canReview ? <nav className="workspace-sections" aria-label="Leave sections"><Link replace to={sectionPath('requests')} aria-current={view==='requests'?'page':undefined}>My leave</Link><Link replace to={sectionPath('review')} aria-current={view==='review'?'page':undefined}>To review</Link></nav> : null}</>:null}
        {open ? (
          <section className="staff-panel staff-apply">
            <form
              className="staff-form"
              onSubmit={(event) => void submit(event)}
            >
              <LeaveReviewReadinessNotice schoolId={schoolId} readiness={readiness} command={command} allowConfiguration={false} />
              {!hasPolicy ? <LeavePolicyReadinessNotice canConfigure={false} /> : null}
              <fieldset className="staff-leave-fields" disabled={command.blocked}>
              <div className="staff-form-grid">
                <label>
                  From
                  <TemporalInput name="starts_on" type="date" required value={leaveDraft.starts_on} onChange={event => setLeaveDraft(current => ({ ...current, starts_on: event.target.value }))} />
                </label>
                <label>
                  To
                  <TemporalInput name="ends_on" type="date" required min={leaveDraft.starts_on || undefined} value={leaveDraft.ends_on} onChange={event => setLeaveDraft(current => ({ ...current, ends_on: event.target.value }))} />
                </label>
                {hasPolicy ? <label className="staff-span">
                  Leave type
                  <select name="policy_id" aria-label="Leave type" aria-describedby="staff-selected-balance" required value={policyId} onChange={event => setLeaveDraft(current => ({ ...current, policy_id: event.target.value }))}>
                    {data.balances.map((balance) => (
                      <option value={balance.policy_id} key={balance.policy_id}>
                        {balance.name}
                      </option>
                    ))}
                  </select>
                  <span id="staff-selected-balance" className="staff-selected-balance">{days(available)} days available{number(selectedBalance?.pending ?? 0) > 0 ? ` · ${days(number(selectedBalance?.pending ?? 0))} pending` : ''}</span>
                </label> : null}
                <label className="staff-span">
                  Reason
                  <textarea
                    name="reason"
                    required
                    minLength={8}
                    maxLength={1000}
                    rows={2}
                    placeholder="Why you need leave"
                  />
                </label>
                <details className="staff-span staff-optional-handover">
                  <summary>Half-day or handover <span>Optional</span></summary>
                  <label>
                    Day type
                    <select name="portion" value={leaveDraft.portion} onChange={event => setLeaveDraft(current => ({ ...current, portion: event.target.value as StaffLeaveImpactInput["portion"] }))}>
                      <option value="full_day">Full day</option>
                      <option value="first_half">First half</option>
                      <option value="second_half">Second half</option>
                    </select>
                  </label>
                  <label>
                    Handover note
                    <textarea name="handover_note" maxLength={1000} rows={2} placeholder="Classes or duties that need cover" />
                  </label>
                </details>
              </div>
              </fieldset>
              <StaffLeaveImpactPreview schoolId={schoolId} actorId={actorId} input={{ ...leaveDraft, policy_id: hasPolicy ? policyId : "" }} />
              <div className="staff-form-actions"><button type="button" className="staff-secondary" disabled={command.blocked} onClick={()=>setOpen(false)}>Cancel</button><button className="staff-primary" disabled={command.blocked || reviewUnavailable || !hasPolicy}>
                {command.busy === "new-request" ? "Sending…" : "Send request"}
              </button></div>
            </form>
          </section>
        ) : null}
        <LeaveCommandFeedback command={command} />
        {!open&&view==='review'?<LeaveReview schoolId={schoolId} actorId={actorId} data={data} refresh={refresh} focusRequestId={focusRequestId}/>:null}
        {!open&&view==='requests'&&hasPolicy?<details className="staff-personal-balances" open={params.get('view')==='balances'||undefined}><summary>Leave balances <ChevronRight size={18} aria-hidden="true" /></summary><section className="staff-balance-grid" aria-label="Leave balances">
          {data.balances.map((balance) => {
            const allowance =
              number(balance.annual_allowance) + number(balance.adjustments);
            const used = number(balance.used);
            const pending = number(balance.pending);
            const remain = allowance - used - pending;
            return (
              <article key={balance.policy_id}>
                <span className="staff-policy-icon">
                  <CalendarCheck2 size={19} />
                </span>
                <div>
                  <strong>{balance.name}</strong>
                  <small>
                    {balance.is_paid ? "Paid" : "Unpaid"}
                    {balance.is_statutory ? " · statutory" : ""}
                  </small>
                </div>
                <b>
                  {days(remain)}
                  <small>available</small>
                </b>
                <div className="staff-balance-bar">
                  <span
                    style={{
                      width: `${allowance ? Math.min(100, (used / allowance) * 100) : 0}%`,
                    }}
                  />
                </div>
                <p>
                  {days(used)} used · {days(pending)} pending ·{" "}
                  {days(allowance)} total
                </p>
              </article>
            );
          })}
        </section></details>:null}
        {!open&&view==='requests'?<section className="staff-panel staff-my-requests" aria-label="Leave requests">
          {personalRequests.length ? (
            <div className="staff-request-list">
              {personalRequests.map((request) => request.status !== "submitted" ? <DecidedLeaveRequest key={request.id} request={request} personal focused={request.id === focusRequestId} /> : (
                <article
                  id={`attention-${request.id}`}
                  tabIndex={-1}
                  className={`staff-request staff-request--personal staff-request--${request.status}${request.id === focusRequestId ? " attention-focus" : ""}`}
                  key={request.id}
                >
                  <header>
                    <span className="staff-policy-icon">
                      <CalendarClock size={18} />
                    </span>
                    <div>
                      <strong>{request.policy_name}</strong>
                      <small>
                        {displayDate(request.starts_on)}
                        {request.ends_on !== request.starts_on
                          ? ` – ${displayDate(request.ends_on)}`
                          : ""}
                      </small>
                    </div>
                    <em
                      className={`staff-status staff-status--${request.status}`}
                    >
                      Pending
                    </em>
                  </header>
                  <div className="staff-request__dates">
                    <span>
                      <strong>
                        {days(number(request.requested_days))} day
                        {number(request.requested_days) === 1 ? "" : "s"}
                      </strong>
                    </span>
                    <span>
                      <strong>{request.affected_periods} {request.affected_periods === 1 ? "activity" : "activities"}</strong>
                    </span>
                  </div>
                  <p>{request.reason}</p>
                  <LeaveReviewRouteSummary request={request} />
                  {request.decision_note ? (
                    <small className="staff-handover">
                      Decision: <span>{request.decision_note}</span>
                    </small>
                  ) : null}
                  {request.status === "submitted" ? <div className="staff-request-actions">
                    {request.review_route?.can_reroute && request.review_route.state !== "current" ? <button
                      type="button" className="staff-primary" disabled={command.blocked} onClick={() => void reroute(request)}
                    >{command.busy === request.id ? "Sending…" : "Send to current reviewer"}</button> : null}
                    <button
                      type="button"
                      className="staff-secondary staff-withdraw"
                      disabled={command.blocked}
                      onClick={() => void withdraw(request)}
                    >
                      {command.busy === request.id && command.busyOperation === "withdraw"
                        ? "Withdrawing…"
                        : "Withdraw request"}
                    </button>
                  </div> : null}
                </article>
              ))}
            </div>
          ) : (
            <p className="staff-empty">No leave requests yet.</p>
          )}
        </section>:null}
      </div>
    </OperationsShell>
  );
}
