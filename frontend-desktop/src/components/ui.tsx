import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/* ---------- status: colour + shape + word ---------- */
export type Tone = "pos" | "cau" | "cri" | "inf" | "neu";

const GLYPH: Record<Tone, ReactNode> = {
  pos: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9" /></svg>,
  cau: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M10 2.5L18.5 17.5H1.5z" /></svg>,
  cri: <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /></svg>,
  inf: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>,
  neu: <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.6" aria-hidden="true"><circle cx="10" cy="10" r="7" /></svg>,
};

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`st ${tone}`}>{GLYPH[tone]}{children}</span>;
}

/* Plain rounded pill (no glyph) — the design's label chips. */
export function Pill({ kind, children }: { kind?: "soft" | "brand" | "tint" | "pos" | "cri" | "cau" | "high"; children: ReactNode }) {
  return <span className={`pill${kind ? ` ${kind}` : ""}`}>{children}</span>;
}

export function attendanceTone(status: string | null | undefined): Tone {
  switch (status) {
    case "present": return "pos";
    case "late": case "half_day": return "cau";
    case "absent": return "cri";
    case "excused": return "inf";
    default: return "neu";
  }
}
export function submissionTone(s: "not_started" | "in_progress" | "submitted"): Tone {
  return s === "submitted" ? "pos" : s === "in_progress" ? "cau" : "cri";
}
export function leaveTone(status: string): Tone {
  if (status === "approved" || status === "school_approved") return "pos";
  if (status === "rejected" || status === "school_rejected") return "cri";
  if (status === "declined" || status === "withdrawn") return "neu";
  if (status.startsWith("pending") || status === "authorized") return "cau";
  return "inf";
}
/* Short status words for the school side; the API's labels are written for families. */
export const LEAVE_STATUS: Record<string, string> = {
  draft: "Draft", pending_guardian: "Awaiting guardian", authorized: "Awaiting decision", declined: "Declined by guardian",
  school_approved: "Approved", school_rejected: "Rejected", withdrawn: "Withdrawn",
};
export const leaveLabel = (status: string) => LEAVE_STATUS[status] ?? plain(status);
export function pctTone(pct: number, threshold = 85): Tone {
  return pct >= Math.max(threshold + 5, 90) ? "pos" : pct >= threshold ? "inf" : pct >= threshold - 10 ? "cau" : "cri";
}
export const plain = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const toneColor = (tone?: Tone) => tone === "cau" ? "var(--cau-ink)" : tone === "pos" ? "var(--pos)" : tone === "cri" ? "var(--cri)" : tone === "inf" ? "var(--brand-text)" : "var(--ink-2)";

/* ---------- toasts ---------- */
interface Toast { id: number; text: string; bad?: boolean }
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, text, bad }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), 3800);
  }, []);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast${t.bad ? " bad" : ""}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- small blocks ---------- */
export function IconSq({ icon: Icon, kind, size = "md" }: { icon: LucideIcon; kind?: "fill" | "sec" | "pos" | "cri" | "cau" | "tint" | "high" | "hover-fill"; size?: "md" | "lg" | "xl" }) {
  return <span className={`icon-sq${size !== "md" ? ` ${size}` : ""}${kind ? ` ${kind}` : ""}`}><Icon size={size === "xl" ? 26 : size === "lg" ? 20 : 18} strokeWidth={2} /></span>;
}

/* Metric card: label + icon square, headline value, coloured note.
   `tile` renders the in-panel variant on surface-container-low. */
export function Stat({ label, value, unit, tone, note, icon, iconKind, tile }: {
  label: string; value: ReactNode; unit?: ReactNode; tone?: Tone; note?: ReactNode; icon?: LucideIcon;
  iconKind?: "fill" | "sec" | "pos" | "cri" | "cau" | "tint" | "high"; tile?: boolean;
}) {
  const kind = iconKind ?? (tone === "cri" ? "cri" : tone === "pos" ? "pos" : tone === "cau" ? "cau" : undefined);
  return (
    <div className={`stat${tile ? " tile" : ""}`}>
      <div className="hd"><span>{label}</span>{icon ? <IconSq icon={icon} kind={kind} /> : null}</div>
      <div>
        <div className="v">{value}{unit ? <small>{unit}</small> : null}</div>
        {note ? <div className="n" style={{ color: toneColor(tone) }}>{note}</div> : null}
      </div>
    </div>
  );
}

export function Initials({ name, src, size }: { name: string; src?: string | null; size?: number }) {
  const ini = name.split(" ").filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  // Initials always render; a photo sits on top and simply disappears if it fails to load.
  return <div className="av" style={{ position: "relative", ...(size ? { width: size, height: size } : {}) }}>{ini}{src ? <img src={src} alt="" style={{ position: "absolute", inset: 0 }} onError={(e) => { e.currentTarget.style.display = "none"; }} /> : null}</div>;
}

export function Skeleton({ h = 18, w = "100%" }: { h?: number; w?: string | number }) {
  return <div className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/* Page header: eyebrow (icon + label) above a headline-xl, body-md sub, actions on the right. */
export function PageTitle({ eyebrow, icon: Icon, title, sub, actions }: { eyebrow?: ReactNode; icon?: LucideIcon; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="head">
      <div style={{ minWidth: 0 }}>
        {eyebrow ? <div className="eyebrow">{Icon ? <Icon size={16} strokeWidth={2} /> : null}{eyebrow}</div> : null}
        <h1 className="t-hxl">{title}</h1>
        {sub ? <div className="sub">{sub}</div> : null}
      </div>
      {actions ? <div className="btnrow">{actions}</div> : null}
    </div>
  );
}

/* Section header inside a panel: icon + headline-lg on the left, anything on the right. */
export function SectionTitle({ icon: Icon, title, small, aside, dot }: { icon?: LucideIcon; title: ReactNode; small?: boolean; aside?: ReactNode; dot?: boolean }) {
  return (
    <div className="sec-h">
      <h2 className={`ttl${small ? " sm" : ""}`}>{dot ? <span className="dot" /> : null}{Icon ? <Icon size={small ? 20 : 24} strokeWidth={2} /> : null}{title}</h2>
      {aside ? <div className="btnrow">{aside}</div> : null}
    </div>
  );
}

/* Segmented tabs: soft track, white active tab. */
export function Tabs<T extends string>({ value, onChange, items, large }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: ReactNode; count?: number }>; large?: boolean }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={`tab${large ? " lg" : ""}`} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className="cnt">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct, tone }: { pct: number; tone?: Tone | "hover" }) {
  const w = Math.max(0, Math.min(100, pct));
  return <div className="bar"><i className={tone ?? ""} style={{ width: `${w}%` }} /></div>;
}

export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat(undefined, opts).format(d);
}
export const today = () => new Date().toISOString().slice(0, 10);
export const hm = (t: string | null | undefined) => (t ?? "").slice(0, 5);
export const fmtTime = (iso: string | null | undefined) => fmtDate(iso, { hour: "2-digit", minute: "2-digit" });
