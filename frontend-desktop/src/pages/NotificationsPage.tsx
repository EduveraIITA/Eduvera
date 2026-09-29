import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Bell, BookOpen, CalendarX2, CheckCircle2, ClipboardCheck, Info } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { normaliseNotifications, staffApi, type Notification } from "../features/staff";
import { Empty, IconSq, PageTitle, Skeleton, Tabs, fmtDate, useToast } from "../components/ui";

type Filter = "all" | "unread" | "academics" | "notices";

function classify(n: Notification): { icon: typeof Bell; kind: "cri" | "cau" | "tint" | "pos" | "high"; group: "academics" | "notices" } {
  const k = `${n.kind} ${n.title}`.toLowerCase();
  if (/leave/.test(k)) return { icon: CalendarX2, kind: /reject|declin/.test(k) ? "cri" : /approv|authori/.test(k) ? "pos" : "cau", group: "academics" };
  if (/attendance|register|absent|late/.test(k)) return { icon: ClipboardCheck, kind: /absent|missing|not started/.test(k) ? "cri" : "tint", group: "academics" };
  if (/diary|homework|note/.test(k)) return { icon: BookOpen, kind: "tint", group: "academics" };
  if (/clash|conflict|alert|warning/.test(k)) return { icon: AlertTriangle, kind: "cau", group: "notices" };
  return { icon: Info, kind: "high", group: "notices" };
}

/* Local app path from a notification link (the API returns mobile-app paths). */
function target(n: Notification): string | null {
  const l = n.link ?? "";
  if (/leave/.test(l)) return "/leave";
  if (/attendance/.test(l)) return "/attendance";
  if (/diary/.test(l)) return "/diary";
  if (/timetable/.test(l)) return "/timetable";
  return null;
}

function dayLabel(iso: string): string {
  const d = new Date(iso); const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, now)) return "Today";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (same(d, y)) return "Yesterday";
  return fmtDate(iso, { weekday: "long", day: "numeric", month: "long" });
}

export function NotificationsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const q = useQuery({ queryKey: ["notifications"], queryFn: staffApi.notifications, select: normaliseNotifications });
  const read = useMutation({
    mutationFn: (id: string) => staffApi.markRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
    onError: (e: Error) => toast(e.message, true),
  });
  const readAll = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await staffApi.markRead(id); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["notifications"] }); toast("All marked read."); },
    onError: (e: Error) => toast(e.message, true),
  });
  const items = [...(q.data ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const unread = items.filter((n) => !n.read_at);
  const shown = items.filter((n) => filter === "all" || (filter === "unread" ? !n.read_at : classify(n).group === filter));
  const groups = new Map<string, Notification[]>();
  for (const n of shown) { const k = dayLabel(n.created_at); groups.set(k, [...(groups.get(k) ?? []), n]); }

  return (
    <>
      <PageTitle icon={Bell} eyebrow={<>School desk<span className="sep" />Inbox</>} title="Notifications"
        sub={unread.length ? `${unread.length} item${unread.length === 1 ? "" : "s"} still need${unread.length === 1 ? "s" : ""} your attention.` : "Nothing unread. Everything the school has sent you, newest first."}
        actions={<>
          <Tabs value={filter} onChange={setFilter} items={[{ id: "all", label: "All" }, { id: "unread", label: "Unread", count: unread.length }, { id: "academics", label: "Academics" }, { id: "notices", label: "Notices" }]} />
          <button className="btn link" disabled={!unread.length || readAll.isPending} onClick={() => readAll.mutate(unread.map((n) => n.id))}>Mark all read</button>
        </>} />

      <div style={{ maxWidth: 1024 }} className="col">
        {q.isPending ? <Skeleton h={220} /> : shown.length === 0 ? <div className="card"><Empty>{items.length ? "Nothing matches this filter." : "No notifications yet."}</Empty></div> : [...groups.entries()].map(([label, list]) => (
          <div className="col sm" key={label}>
            <span className="lbl">{label}</span>
            <div className="col xs">
              {list.map((n) => {
                const c = classify(n); const to = target(n); const isNew = !n.read_at;
                return (
                  <div key={n.id} className={`card lg${isNew ? " ring" : ""}`} style={{ padding: 20, display: "flex", gap: 16, alignItems: "flex-start" }}>
                    <IconSq icon={c.icon} kind={c.kind} size="lg" />
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <span className="t-hsm" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{isNew ? <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--brand)", flexShrink: 0 }} /> : null}{n.title}</span>
                        <span className="lbl" style={{ flexShrink: 0 }}>{fmtDate(n.created_at, { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      {n.body ? <p className="t-bmd ink2">{n.body}</p> : null}
                      <div className="btnrow">
                        {to ? <Link className="btn link" to={to} onClick={() => { if (isNew) read.mutate(n.id); }}>Open<ArrowRight size={16} /></Link> : null}
                        {isNew ? <button className="btn link" style={{ color: "var(--muted)" }} disabled={read.isPending} onClick={() => read.mutate(n.id)}><CheckCircle2 size={16} />Mark read</button> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
