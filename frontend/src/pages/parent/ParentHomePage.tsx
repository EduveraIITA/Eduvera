import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  BookOpen,
  Bus,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  ClipboardList,
  PenLine,
  Phone,
  PieChart,
  Sigma,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { fallbackHomeData } from "./parentDemoData";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { getAccessibleStudents } from "../../features/school/api";
import { StudentIdentityCard } from "../student/StudentIdentityCard";
import { AttendanceRankingDialog } from "../../features/school/AttendanceRankingDialog";
import { HomeworkDetailsDialog } from "../../features/school/HomeworkDetailsDialog";
import { ParentShell } from "./ParentShell";
import { FollowupInbox } from "../../features/coordination/FollowupInbox";
import type { ParentHomeData, ParentPageAction } from "./parentTypes";
import {DayPlanNotice} from '../../features/day-plans/DayPlanNotice';
import "./parent-pages.css";

export interface ParentHomePageProps {
  data?: ParentHomeData;
  onSelectChild?: (childId: string) => ParentPageAction;
  onPrepareChild?: (childId: string) => Promise<ParentHomeData>;
  onContactTeacher?: () => ParentPageAction;
  onToggleHomework?: (itemId: string, completed: boolean) => Promise<void>;
}
type CardDirection = "left" | "right";
type CardTransition = { phase: "preparing" | "animating" | "completed"; targetId: string; direction: CardDirection; incoming?: ParentHomeData };
function MetricCard({
  label,
  icon,
  value,
  children,
  tone,
  insight,
  valueAccessory,
  onOpen,
}: {
  label: string;
  icon: ReactNode;
  value: string;
  children: ReactNode;
  tone?: "positive";
  insight?: ReactNode;
  valueAccessory?: ReactNode;
  onOpen?: () => void;
}) {
  return (
    <article className="metric-card">
      <div className="metric-card__header">
        <span>{label}{onOpen ? <span className="metric-card__open-indicator" aria-hidden="true"> ↗</span> : null}</span>
        {icon}
      </div>
      <div className="metric-card__value-row">
        <strong className={tone === "positive" ? "metric-card__value is-positive" : "metric-card__value"}>{value}</strong>
        {valueAccessory}
      </div>
      <div className="metric-card__detail">{children}</div>
      {insight ? <div className="metric-card__insight">{insight}</div> : null}
      {onOpen && <button type="button" className="metric-card__hit-area" onClick={onOpen} aria-label={label === "Attendance" ? "View all class attendance" : "View homework details"} />}
    </article>
  );
}

function MetricTrend({ value, label, higherIsBetter = true, suffix = "%", compact = false }: { value?: number | null; label: string; higherIsBetter?: boolean; suffix?: string; compact?: boolean }) {
  if (value == null) return <span className="metric-trend metric-trend--neutral" aria-label="Trend unavailable">{compact ? "-" : "Trend unavailable"}</span>;
  const tone = value === 0 ? "neutral" : (value > 0) === higherIsBetter ? "positive" : "negative";
  const Icon = value > 0 ? TrendingUp : value < 0 ? TrendingDown : Minus;
  return <span className={`metric-trend metric-trend--${tone}${compact ? " metric-trend--compact" : ""}`} aria-label={`${value > 0 ? "Up " : value < 0 ? "Down " : "No change, "}${Math.abs(value)}${suffix} ${label}`}><Icon size={14} aria-hidden="true" />{value > 0 ? "+" : ""}{value}{suffix}{compact ? null : <small>{label}</small>}</span>;
}

export function ParentHomePage({
  data = fallbackHomeData,
  onSelectChild,
  onPrepareChild,
  onContactTeacher,
  onToggleHomework,
}: ParentHomePageProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const auth = useOptionalAuth();
  const [transition, setTransition] = useState<CardTransition | null>(null);
  const [switchError, setSwitchError] = useState("");
  const [rankingOpen, setRankingOpen] = useState(false);
  const [homeworkOpen, setHomeworkOpen] = useState(false);
  const switchTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (switchTimer.current !== null) window.clearTimeout(switchTimer.current);
    };
  }, []);
  const activeTransition = transition?.phase === "completed" && transition.targetId === data.child.id ? null : transition;
  const schoolName = auth?.memberships.find((membership) => membership.role === "guardian")?.school_name ?? "Cambridge International School";
  const childrenQuery = useQuery({ queryKey: ["school", "accessible-students"], queryFn: getAccessibleStudents, staleTime: 60_000 });
  const children = childrenQuery.data?.results.map((student) => ({ id: student.id, name: student.user.display_name, grade: `Grade ${student.current_enrollment.grade}`, section: student.current_enrollment.section, avatarUrl: student.avatar_url })) ?? [];
  const visibleChildId = activeTransition?.phase === "completed" ? activeTransition.targetId : data.child.id;
  const currentChildIndex = children.findIndex((student) => student.id === visibleChildId);
  const nextChild = children.length > 1
    ? children[(currentChildIndex + 1) % children.length]
    : data.sibling;
  const previousChild = children.length > 1
    ? children[(currentChildIndex - 1 + children.length) % children.length]
    : data.sibling;
  const childCount = Math.max(children.length, data.sibling ? 2 : 1);
  const switchToChild = async (childId: string, preferredDirection?: CardDirection) => {
    if (!onSelectChild || activeTransition || childId === data.child.id) return;
    const direction = preferredDirection ?? (previousChild?.id === childId ? "right" : "left");
    setSwitchError("");
    setTransition({ phase: "preparing", targetId: childId, direction });
    let incoming: ParentHomeData | undefined;
    try {
      incoming = await onPrepareChild?.(childId);
    } catch {
      if (!mounted.current) return;
      setTransition(null);
      setSwitchError("Could not load this student's card. Please try again.");
      return;
    }
    if (!mounted.current) return;
    setTransition({ phase: "animating", targetId: childId, direction, incoming });
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    switchTimer.current = window.setTimeout(() => {
      setTransition({ phase: "completed", targetId: childId, direction, incoming });
      void onSelectChild(childId);
      switchTimer.current = null;
    }, reducedMotion ? 0 : 620);
  };
  const swipeCard = (direction: CardDirection) => {
    const target = direction === "right" ? previousChild : nextChild;
    if (target) void switchToChild(target.id, direction);
  };
  const selectedStudentId = searchParams.get("student_id");
  const parentPath = (path: string) =>
    selectedStudentId ? `${path}${path.includes("?") ? "&" : "?"}student_id=${encodeURIComponent(selectedStudentId)}` : path;
  const pendingLeave = data.pendingLeave;
  const currentPeriod = data.currentPeriod;
  const homeworkRecent = data.metrics.homeworkRecent;
  const homeworkPrevious = data.metrics.homeworkPrevious;
  const homeworkTrend = homeworkRecent === undefined || homeworkPrevious === undefined ? null
    : homeworkPrevious ? Math.round((homeworkRecent - homeworkPrevious) * 100 / homeworkPrevious)
      : homeworkRecent ? homeworkRecent : 0;

  const openLeaveReview = (clarification = false) => {
    if (!pendingLeave) return;
    const params = new URLSearchParams();
    params.set("leave_id", pendingLeave.id);
    if (selectedStudentId) params.set("student_id", selectedStudentId);
    if (clarification) params.set("clarify", "1");
    void navigate(`/parent/leave?${params.toString()}`);
  };

  return (
    <ParentShell
      active="home"
      pageLabel="Home"
      child={data.child}
      presenceStatus={data.presence.status === "In School" ? "in" : data.presence.status === "Checked Out" ? "away" : undefined}
      onSelectChild={(childId) => { void switchToChild(childId); }}
      childOptions={children.length ? children : data.sibling ? [data.child, data.sibling] : [data.child]}
      selectedChildId={visibleChildId}
      childSwitchDisabled={Boolean(activeTransition)}
    >
      <div className="parent-stack home-page">
        <div className={`parent-id-stack${childCount > 1 ? " has-multiple" : ""}${childCount > 2 ? " has-three-or-more" : ""}${activeTransition ? ` is-${activeTransition.phase} direction-${activeTransition.direction}` : ""}`} aria-busy={activeTransition?.phase === "preparing"}>
          {activeTransition?.phase === "animating" && activeTransition.incoming ? <div className="parent-id-stack__incoming" aria-hidden="true" inert>
            <StudentIdentityCard identity={activeTransition.incoming.idCard} schoolName={schoolName} primaryHeading={false} showSwitchButton={false} />
          </div> : null}
          <div className="parent-id-stack__active">
            <StudentIdentityCard identity={activeTransition?.phase === "completed" ? activeTransition.incoming?.idCard ?? data.idCard : data.idCard} schoolName={schoolName} primaryHeading={false} showSwitchButton={false} switchChild={nextChild && onSelectChild ? { name: nextChild.name.split(" ")[0] ?? nextChild.name, onSelect: () => { void switchToChild(nextChild.id, "left"); }, onSwipe: swipeCard } : undefined} />
          </div>
        </div>
        {switchError ? <p className="parent-id-stack__error" role="alert">{switchError}</p> : null}
        <DayPlanNotice plan={data.dayPlan} href={`/parent/timetable?student=${data.child.id}`}/>
        <FollowupInbox context="guardian" studentId={data.child.id} />

        <section className="home-action-section" aria-labelledby="action-required-heading">
          <div className="section-eyebrow-row">
            <h2 id="action-required-heading">{pendingLeave ? <span className="alert-dot" /> : null}{pendingLeave ? "Action Required" : "Guardian Actions"}</h2>
            {pendingLeave ? (
              <span className="status-pill status-pill--danger">1 Pending Sign</span>
            ) : null}
          </div>
          <article className="surface-card urgent-leave-card" aria-live="polite">
            {!pendingLeave ? (
              <div className="completed-message">
                <CheckCircle2 size={23} />
                <div><strong>No leave sign-off required</strong><span>New leave sign-offs will appear here when the school receives them.</span></div>
              </div>
            ) : (
              <div className="urgent-leave-card__body">
                <div className="action-icon action-icon--danger"><PenLine size={23} /></div>
                <div className="urgent-leave-card__content">
                  <div className="title-row title-row--spread">
                    <h3>{pendingLeave.title}</h3>
                    <span className="time-label">{pendingLeave.submittedLabel}</span>
                  </div>
                  <p>{pendingLeave.summary} - <strong>{pendingLeave.durationLabel}</strong></p>
                </div>
                <div className="button-row urgent-leave-card__actions">
                  <button className="button button--primary button--grow" type="button" onClick={() => openLeaveReview()}>
                    <CheckCircle2 size={17} /><span>Review &amp; Sign</span>
                  </button>
                  <button className="button button--soft" type="button" onClick={() => openLeaveReview(true)}>Ask clarification</button>
                </div>
              </div>
            )}
          </article>
          <button className="surface-card diary-unread-card" type="button" onClick={() => navigate(parentPath("/parent/diary"))}>
            <span className="action-icon"><BookOpen size={19} /></span>
            <span><strong>{data.unreadDiaryCount > 0 ? `${data.unreadDiaryCount} Unread Diary Note${data.unreadDiaryCount === 1 ? "" : "s"}` : "No unread diary notes"}</strong><small>{data.unreadDiaryCount > 0 ? `From ${data.diarySender}` : data.diarySender}</small></span>
            <ChevronRight size={20} />
          </button>
        </section>

        <section className="surface-card pulse-card" aria-labelledby="pulse-heading">
          <div className="card-heading-row">
            <h2 id="pulse-heading"><Clock3 size={20} />Academic Pulse</h2>
            <span className={`status-pill ${data.presence.status === "In School" ? "status-pill--success" : data.presence.status === "Checked Out" ? "status-pill--danger" : "status-pill--neutral"}`}>{data.presence.status === "Not confirmed" ? <Clock3 size={14} /> : <CheckCircle2 size={14} />}{data.presence.status}</span>
          </div>
          {currentPeriod ? <div className="current-period">
            <div className="current-period__meta">
              <span className="period-badge">Period {currentPeriod.number}</span>
              <span>{currentPeriod.startsAt} - {currentPeriod.endsAt}</span>
              <strong>{currentPeriod.remainingLabel}</strong>
            </div>
            <div className="current-period__subject">
              <div><h3>{currentPeriod.subject} - {currentPeriod.topic}</h3><p>{currentPeriod.room} - {currentPeriod.teacher}</p></div>
              <span className="subject-icon"><Sigma size={21} /></span>
            </div>
            <div className="progress-track" aria-label={`${currentPeriod.progressPercent}% of period complete`}>
              <span style={{ width: `${currentPeriod.progressPercent}%` }} />
            </div>
          </div> : <div className="completed-message completed-message--neutral"><CalendarDays size={22} /><div><strong>No classes scheduled today</strong><span>The timetable has no periods for this date.</span></div></div>}
          {data.nextPeriod ? <div className="next-period">
            <ChevronRight size={17} />
            <span>Next: <strong>Period {data.nextPeriod.number} - {data.nextPeriod.subject}</strong> ({data.nextPeriod.room})</span>
            <time>{data.nextPeriod.startsAt}</time>
          </div> : null}
        </section>

        <section aria-labelledby="metrics-heading">
          <div className="section-eyebrow-row">
            <h2 id="metrics-heading">Semester Metrics</h2>
            <span className="section-link-label">{data.metrics.termLabel}</span>
          </div>
          <div className="metric-grid">
            <MetricCard label="Attendance" icon={<PieChart size={19} />} value={data.metrics.attendance} onOpen={() => setRankingOpen(true)}
              valueAccessory={<MetricTrend value={data.metrics.attendanceTrend} label="vs prior recorded days" compact />} insight={<>
              <span className="metric-card__rank">{data.metrics.attendanceTrend == null ? "Not enough attendance history" : "vs prior recorded days"}</span>
              <span className="metric-card__rank">{data.metrics.attendanceRank ? `Class rank #${data.metrics.attendanceRank}${data.metrics.attendanceCohortSize ? ` of ${data.metrics.attendanceCohortSize}` : ""}` : "Class rank not published"}</span>
            </>}>
              <span className="mini-pill mini-pill--success">{data.metrics.attendanceStatus}</span><span>{data.metrics.threshold}</span>
            </MetricCard>
            <MetricCard label="Schedule" icon={<CalendarDays size={19} />} value={`${data.metrics.periodsToday} Periods`}>
              <span>Dismissal:</span><strong className="blue-text">{data.metrics.dismissal}</strong>
            </MetricCard>
            <MetricCard label="Homework" icon={<ClipboardList size={19} />} value={data.metrics.homeworkTotal === undefined ? `${data.metrics.homeworkTasks} Pending` : `${data.metrics.homeworkTasks}/${data.metrics.homeworkTotal}`} onOpen={() => setHomeworkOpen(true)}
              valueAccessory={<MetricTrend value={homeworkTrend} suffix={homeworkPrevious === 0 && (homeworkRecent ?? 0) > 0 ? " new" : "%"} label="last 30d vs prior 30d" higherIsBetter={false} compact />} insight={<>
              <span className="metric-card__rank">{data.metrics.homeworkTotal === undefined ? "Term history unavailable" : `${data.metrics.homeworkTotal} assigned this term`}</span>
              <span className="metric-card__rank">{homeworkTrend == null ? "Not enough homework history" : "last 30d vs prior 30d"}</span>
            </>}>
              <span className="blue-dot" /><span>{data.metrics.homeworkTasks} pending</span>
            </MetricCard>
            <MetricCard label="Dues Status" icon={<CheckCircle2 size={19} />} value={data.metrics.duesStatus} tone="positive">
              <span>{data.metrics.duesDetail}</span>
            </MetricCard>
          </div>
          {rankingOpen && <AttendanceRankingDialog ranking={data.ranking} className={data.idCard.className} currentLabel="Your child" onClose={() => setRankingOpen(false)} />}
          {homeworkOpen && <HomeworkDetailsDialog items={data.homeworkItems} total={data.metrics.homeworkTotal} onToggle={onToggleHomework} onClose={() => setHomeworkOpen(false)} />}
        </section>

        <section aria-labelledby="shortcuts-heading">
          <div className="section-eyebrow-row"><h2 id="shortcuts-heading">Shortcuts & Desk</h2></div>
          <div className="surface-card shortcut-list">
            <button type="button" disabled={!onContactTeacher} aria-disabled={!onContactTeacher} onClick={() => void onContactTeacher?.()}>
              <span className="shortcut-icon"><Phone size={19} /></span>
              <span><strong>{onContactTeacher ? "Contact Homeroom Teacher" : "Teacher contact unavailable"}</strong><small>{data.homeroomTeacher.name} - {data.homeroomTeacher.availability}</small></span>
              <ChevronRight size={21} />
            </button>
            <button type="button" onClick={() => navigate(parentPath("/parent/leave?tab=apply"))}>
              <span className="shortcut-icon"><CalendarDays size={19} /></span>
              <span><strong>Submit Future Leave Application</strong><small>Medical, family, or personal leave</small></span>
              <ChevronRight size={21} />
            </button>
            <button type="button" disabled aria-disabled="true" title="Transport self-service is planned for a later School OS module" aria-label={`${data.transport.passLabel}. ${data.transport.pickupWindow}. View only.`}>
              <span className="shortcut-icon"><Bus size={19} /></span>
              <span><strong>{data.transport.passLabel}</strong><small className="green-text">{data.transport.pickupWindow} - View only</small></span>
            </button>
          </div>
        </section>
      </div>
    </ParentShell>
  );
}
