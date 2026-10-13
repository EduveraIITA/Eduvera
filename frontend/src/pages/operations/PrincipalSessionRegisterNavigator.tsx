import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { TeacherClassSummary } from "../../features/operations/api";
import { schoolClock } from "../../lib/schoolTime";

type RegisterQueue = "pending" | "submitted" | "finalizing" | "locked" | "not_required";
type Grouping = "period" | "class";

export interface PrincipalSessionRegisterItem {
  register: TeacherClassSummary;
  href: string;
  queue: RegisterQueue;
  statusLabel: string;
  attentionLabel?: string;
  attentionTone?: "exception" | "new" | "action";
}

interface RegisterGroup {
  key: string;
  label: string;
  detail: string;
  order: number;
  startsAt: number | null;
  items: PrincipalSessionRegisterItem[];
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function minutes(value: string | null | undefined) {
  if (!value) return null;
  const [hour, minute] = value.split(":").map(Number);
  if (hour === undefined || minute === undefined || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formattedTime(value: string | null | undefined) {
  const valueInMinutes = minutes(value);
  if (valueInMinutes === null) return null;
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, Math.floor(valueInMinutes / 60), valueInMinutes % 60)));
}

function className(item: TeacherClassSummary) {
  return item.class_name || `Class ${item.grade}${item.section}`;
}

function subjectName(item: TeacherClassSummary) {
  return item.subject_name ?? item.subjects?.[0] ?? "Scheduled session";
}

function completed(item: PrincipalSessionRegisterItem) {
  return item.queue === "submitted" || item.queue === "finalizing" || item.queue === "locked";
}

function upcoming(item: PrincipalSessionRegisterItem) {
  return item.register.date_open === false;
}

function pending(item: PrincipalSessionRegisterItem) {
  return item.queue === "pending";
}

function buildGroups(items: PrincipalSessionRegisterItem[], grouping: Grouping): RegisterGroup[] {
  const groups = new Map<string, RegisterGroup>();
  for (const entry of items) {
    const item = entry.register;
    const startsAt = minutes(item.starts_at);
    const period = item.period_number ?? 0;
    const key = grouping === "period"
      ? `period:${period}:${item.starts_at ?? ""}:${item.ends_at ?? ""}`
      : `class:${item.class_section_id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(entry);
      continue;
    }
    const time = formattedTime(item.starts_at) && formattedTime(item.ends_at)
      ? `${formattedTime(item.starts_at)}–${formattedTime(item.ends_at)}`
      : "Time not set";
    groups.set(key, grouping === "period" ? {
      key,
      label: `Period ${period || "—"}`,
      detail: time,
      order: period || Number.MAX_SAFE_INTEGER,
      startsAt,
      items: [entry],
    } : {
      key,
      label: className(item),
      detail: `${item.student_count} students${item.room_number ? ` · ${/^room\b/i.test(item.room_number) ? item.room_number : `Room ${item.room_number}`}` : ""}`,
      order: Number(`${item.grade.replace(/\D/g, "") || "999"}${String(item.section.toUpperCase().charCodeAt(0) || 99).padStart(2, "0")}`),
      startsAt: null,
      items: [entry],
    });
  }
  return [...groups.values()]
    .sort((left, right) => left.order - right.order || collator.compare(left.label, right.label))
    .map((group) => ({
      ...group,
      items: group.items.sort((left, right) => grouping === "period"
        ? collator.compare(className(left.register), className(right.register))
        : (left.register.period_number ?? Number.MAX_SAFE_INTEGER) - (right.register.period_number ?? Number.MAX_SAFE_INTEGER)),
    }));
}

function defaultGroupKey(groups: RegisterGroup[], grouping: Grouping, date: string) {
  const withAttention = groups.find((group) => group.items.some((item) => item.attentionLabel));
  if (withAttention) return withAttention.key;
  if (grouping === "period") {
    const clock = schoolClock();
    if (date === clock.date) {
      const active = groups.find((group) => {
        const first = group.items[0]?.register;
        const start = minutes(first?.starts_at);
        const end = minutes(first?.ends_at);
        return start !== null && end !== null && clock.minutes >= start && clock.minutes < end;
      });
      if (active) return active.key;
      const upcoming = groups.find((group) => group.startsAt !== null && group.startsAt > clock.minutes);
      if (upcoming) return upcoming.key;
    }
  }
  return groups.find((group) => group.items.some((item) => !completed(item)))?.key ?? groups[0]?.key;
}

export function PrincipalSessionRegisterNavigator({ items, date }: { items: PrincipalSessionRegisterItem[]; date: string }) {
  const [grouping, setGrouping] = useState<Grouping>("period");
  const [openByGrouping, setOpenByGrouping] = useState<Record<Grouping, string | null | undefined>>({ period: undefined, class: undefined });
  const groups = buildGroups(items, grouping);
  const requestedOpenGroup = openByGrouping[grouping];
  const openGroup = requestedOpenGroup === null
    ? null
    : requestedOpenGroup && groups.some((group) => group.key === requestedOpenGroup)
      ? requestedOpenGroup
      : defaultGroupKey(groups, grouping, date);
  const completedCount = items.filter(completed).length;
  const pendingCount = items.filter(pending).length;
  const upcomingOnly = items.length > 0 && items.every(upcoming);
  const periods = new Set(items.map((item) => item.register.period_number).filter(Boolean)).size;
  const classes = new Set(items.map((item) => item.register.class_section_id)).size;

  return <div className="principal-register-navigator">
    <div className="principal-register-navigator__overview">
      <p><strong>{items.length}</strong> {items.length === 1 ? "register" : "registers"} · {periods} {periods === 1 ? "period" : "periods"} · {classes} {classes === 1 ? "class" : "classes"}</p>
      <span className={upcomingOnly ? "is-upcoming" : pendingCount ? "is-pending" : undefined}>{upcomingOnly ? "Upcoming" : pendingCount ? `${pendingCount} pending` : completedCount === items.length ? "All submitted" : "No action required"}</span>
    </div>
    <div className="principal-register-navigator__grouping" role="group" aria-label="Group registers">
      <button type="button" aria-pressed={grouping === "period"} onClick={() => setGrouping("period")}>By period</button>
      <button type="button" aria-pressed={grouping === "class"} onClick={() => setGrouping("class")}>By class</button>
    </div>
    <div className="principal-register-groups">
      {groups.map((group) => {
        const done = group.items.filter(completed).length;
        const pendingInGroup = group.items.filter(pending).length;
        const groupUpcoming = group.items.every(upcoming);
        const hasAttention = group.items.some((item) => item.attentionLabel);
        const groupCount = groupUpcoming ? group.items.length : pendingInGroup || done || "—";
        const groupState = groupUpcoming ? "scheduled" : pendingInGroup ? "pending" : done ? "submitted" : "no action";
        return <details className={`principal-register-group${hasAttention ? " has-attention" : ""}`} key={`${grouping}:${group.key}`} open={group.key === openGroup} onToggle={(event) => {
          if (event.currentTarget.open && openGroup !== group.key) setOpenByGrouping((current) => ({ ...current, [grouping]: group.key }));
          if (!event.currentTarget.open && openGroup === group.key) setOpenByGrouping((current) => ({ ...current, [grouping]: null }));
        }}>
          <summary>
            <span className="principal-register-group__identity" aria-hidden="true">{grouping === "period" ? group.label.replace("Period ", "P") : group.label.replace(/^Class\s*/i, "")}</span>
            <span className="principal-register-group__title"><strong>{group.label}</strong><small>{group.detail}</small></span>
            <span className={`principal-register-group__progress${groupUpcoming ? " is-upcoming" : pendingInGroup ? " is-pending" : ""}`}>{groupCount}<small>{groupState}</small></span>
            <ChevronRight size={18} aria-hidden="true" />
          </summary>
          <div className="principal-register-group__rows">
            {group.items.map((entry) => {
              const item = entry.register;
              const teacher = item.assigned_teachers?.[0];
              const supporting = grouping === "period"
                ? `${className(item)}${teacher ? ` · ${teacher}` : ""}`
                : `Period ${item.period_number ?? "—"}${formattedTime(item.starts_at) && formattedTime(item.ends_at) ? ` · ${formattedTime(item.starts_at)}–${formattedTime(item.ends_at)}` : ""}${teacher ? ` · ${teacher}` : ""}`;
              return <Link className={`principal-register-row is-${entry.queue}${entry.attentionTone ? ` has-attention is-${entry.attentionTone}` : ""}`} to={entry.href} key={item.session_id ?? item.class_section_id} aria-label={`${subjectName(item)}, ${supporting}, ${entry.statusLabel}${entry.attentionLabel ? `, ${entry.attentionLabel}, needs attention` : ""}`}>
                <span className="principal-register-row__copy"><strong>{subjectName(item)}{entry.attentionLabel ? <span className={`principal-register-row__attention is-${entry.attentionTone}`} title={entry.attentionLabel}><span className="sr-only"> · {entry.attentionLabel}, needs attention</span></span> : null}</strong><small>{supporting}</small></span>
                <span className="principal-register-row__result"><strong>{entry.statusLabel}</strong><small>{item.date_open === false ? `${item.student_count} students` : `${item.marked_count}/${item.student_count} marked`}</small></span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>;
            })}
          </div>
        </details>;
      })}
    </div>
  </div>;
}
