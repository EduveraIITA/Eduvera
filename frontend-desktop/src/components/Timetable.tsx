import { Coffee } from "lucide-react";
import type { ReactNode } from "react";
import { Status, hm } from "./ui";

/* Shared timetable pieces: a coloured week grid, a day list, the week strip and a
   subject legend. Pages supply the cells; this file only draws them. */

export interface TTPeriod { number: number; starts: string; ends: string }
export interface TTDay { weekday: number; label: string }
export interface TTCell {
  key: string; kind: "class" | "break" | "activity" | "free";
  title: string; sub?: string; color?: string; subjectId?: string | null;
  clash?: boolean; unassigned?: boolean;
}
export type CellFn = (weekday: number, period: number) => TTCell | null;

const PALETTE = ["#1d4ed8", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#0369a1", "#15803d", "#c026d3", "#dc2626", "#4f46e5", "#0891b2", "#65a30d"];
/* Stable colour for subjects the API does not colour (family endpoints). */
export function subjectColor(key: string | null | undefined): string {
  if (!key) return "#747686";
  let h = 0; for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

export const todayWeekday = () => new Date().getDay() || 7;
const nowHM = () => new Date().toTimeString().slice(0, 5);
/* The period running right now, if any. */
export function livePeriod(periods: TTPeriod[]): number | undefined {
  const now = nowHM();
  return periods.find((p) => hm(p.starts) <= now && now < hm(p.ends))?.number;
}
/* Periods from a flat slot list: one entry per period number, earliest times win. */
export function periodsFrom<T extends { period_number: number; starts_at: string; ends_at: string }>(slots: T[]): TTPeriod[] {
  const m = new Map<number, TTPeriod>();
  for (const s of slots) if (!m.has(s.period_number)) m.set(s.period_number, { number: s.period_number, starts: hm(s.starts_at), ends: hm(s.ends_at) });
  return [...m.values()].sort((a, b) => a.number - b.number);
}

function Cell({ c, dim }: { c: TTCell; dim: boolean }) {
  if (c.kind === "free") return <div className="tt-free">Free</div>;
  const color = c.clash ? "var(--cri)" : c.unassigned ? "var(--cau)" : c.color ?? "var(--line-2)";
  return (
    <div className={`tt-cell${dim ? " dim" : ""}${c.clash ? " clash" : ""}`} style={{ "--c": color } as React.CSSProperties}>
      <b>{c.title}</b>
      {c.sub ? <span>{c.sub}</span> : null}
      {c.clash ? <Status tone="cri">Clash</Status> : c.unassigned ? <Status tone="cau">No teacher</Status> : null}
    </div>
  );
}

export function TimetableGrid({ days, periods, cell, highlight, header }: { days: TTDay[]; periods: TTPeriod[]; cell: CellFn; highlight?: string | null; header?: ReactNode }) {
  const todayW = todayWeekday();
  const live = livePeriod(periods);
  return (
    <div className="card lg" style={{ overflow: "hidden" }}>
      {header}
      <div className="tbl-wrap">
        <table className="tbl tt" style={{ tableLayout: "fixed", minWidth: 96 + days.length * 112 }}>
          <thead><tr><th style={{ width: 96 }}>Period</th>{days.map((d) => <th key={d.weekday} className={d.weekday === todayW ? "live" : ""}>{d.label}{d.weekday === todayW ? <span className="tt-today">Today</span> : null}</th>)}</tr></thead>
          <tbody>
            {periods.map((p) => {
              const cells = days.map((d) => cell(d.weekday, p.number));
              const isBreak = cells.length > 0 && cells.every((c) => c === null || c.kind === "break");
              const isLive = p.number === live && days.some((d) => d.weekday === todayW);
              const first = cells.find((c) => c && c.kind === "break");
              return (
                <tr key={p.number} className={isLive ? "now" : ""}>
                  <td><div className="t-llg">P{p.number}</div><div className="lbl" style={{ color: "var(--muted)" }}>{p.starts}–{p.ends}</div>{isLive ? <span className="pill brand" style={{ marginTop: 4 }}>Live</span> : null}</td>
                  {isBreak ? (
                    <td colSpan={days.length} className="tt-breakrow"><div className="tt-break"><Coffee size={16} />{first?.title ?? "Break"} · {p.starts}–{p.ends}</div></td>
                  ) : days.map((d, i) => {
                    const c = cells[i];
                    const cls = d.weekday === todayW ? "live" : "";
                    if (!c) return <td key={d.weekday} className={cls}><div className="tt-free">—</div></td>;
                    const dim = Boolean(highlight) && c.subjectId !== highlight;
                    return <td key={d.weekday} className={cls}><Cell c={c} dim={dim} /></td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DayList({ day, periods, cell }: { day: TTDay; periods: TTPeriod[]; cell: CellFn }) {
  const live = day.weekday === todayWeekday() ? livePeriod(periods) : undefined;
  return (
    <div className="col xs">
      {periods.map((p) => {
        const c = cell(day.weekday, p.number);
        const isLive = p.number === live;
        if (!c || c.kind === "break") return (
          <div key={p.number} className="tt-daybreak"><span className="tm">{p.starts}</span><Coffee size={16} /><span>{c?.title ?? "Free"} · until {p.ends}</span></div>
        );
        const color = c.clash ? "var(--cri)" : c.unassigned ? "var(--cau)" : c.color ?? "var(--line-2)";
        return (
          <div key={p.number} className={`tile md row-tile tt-dayrow${isLive ? " now" : ""}`} style={{ alignItems: "center", "--c": color } as React.CSSProperties}>
            <div style={{ width: 60 }}><div className="t-llg">{p.starts}</div><div className="lbl" style={{ color: "var(--muted)" }}>P{p.number}</div></div>
            <span className="tt-swatch" />
            <div className="rowtxt"><b>{c.title}</b><span>{c.sub}{c.sub ? " · " : ""}ends {p.ends}</span></div>
            {isLive ? <span className="pill brand">Live</span> : c.clash ? <Status tone="cri">Clash</Status> : c.unassigned ? <Status tone="cau">No teacher</Status> : null}
          </div>
        );
      })}
    </div>
  );
}

export function WeekStrip({ days, value, onChange }: { days: TTDay[]; value: number; onChange: (weekday: number) => void }) {
  const todayW = todayWeekday();
  const now = new Date(); const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  return (
    <div className="strip" role="group" aria-label="Day">
      {days.map((d) => {
        const date = new Date(monday); date.setDate(monday.getDate() + d.weekday - 1);
        const on = value === d.weekday;
        return (
          <button key={d.weekday} aria-pressed={on} onClick={() => onChange(d.weekday)}>
            {d.weekday === todayW && on ? <span className="today">Today</span> : null}
            <span className="d">{d.label.slice(0, 3)}</span><span className="n">{date.getDate()}</span>
          </button>
        );
      })}
    </div>
  );
}

/* Subject legend with weekly period counts; click to spotlight one subject in the grid. */
export function Legend({ items, value, onChange, unit = "period" }: { items: Array<{ id: string; name: string; color: string; count: number; sub?: string }>; value: string | null; onChange: (id: string | null) => void; unit?: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="col xs">
      {items.map((s) => (
        <button key={s.id} className={`tile md tt-legend${value === s.id ? " on" : ""}`} onClick={() => onChange(value === s.id ? null : s.id)} aria-pressed={value === s.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="tt-swatch" style={{ "--c": s.color } as React.CSSProperties} />
            <span className="t-llg" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span className="t-lmd ink2">{s.count} {unit}{s.count === 1 ? "" : "s"}</span>
          </div>
          {s.sub ? <span className="t-bsm ink2">{s.sub}</span> : null}
          <div className="bar"><i style={{ width: `${(s.count / max) * 100}%`, background: s.color }} /></div>
        </button>
      ))}
    </div>
  );
}
