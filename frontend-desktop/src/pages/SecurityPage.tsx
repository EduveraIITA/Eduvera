import { useQuery } from "@tanstack/react-query";
import { LogOut, Monitor, Shield } from "lucide-react";
import { Empty, IconSq, PageTitle, SectionTitle, Skeleton, Status, fmtDate } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { RecordForm } from "./administration/RecordForm";

interface Session { current: boolean; user_agent: string; last_seen_at: string; expires_at: string }

/* A short, plain browser name from a user-agent string. */
function browser(ua: string): string {
  if (!ua) return "Unknown browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const name = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return os ? `${name} on ${os}` : name;
}

export function SecurityPage() {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ["sessions"], queryFn: () => api<{ results: Session[] }>("/api/v1/auth/sessions/") });
  const sessions = query.data?.results ?? [];
  const others = sessions.filter((s) => !s.current).length;

  return (
    <>
      <PageTitle icon={Shield} eyebrow={<>Account security<span className="sep" />{user?.username}</>} title="Where you are signed in"
        sub={others ? `${others} other browser${others === 1 ? " is" : "s are"} signed in to this account.` : "Only this browser is signed in."} />
      <div className="grid12">
        <div className="col-7 card">
          <div className="card-h"><b><Monitor size={18} />Active sessions</b><span className="aside">{sessions.length}</span></div>
          {query.isPending ? <div style={{ padding: 16 }}><Skeleton h={64} /></div>
            : query.error ? <Empty>{query.error.message}</Empty>
            : sessions.length === 0 ? <Empty>No active sessions.</Empty>
            : sessions.map((item, index) => (
              <div className="row" key={index}>
                <IconSq icon={Monitor} kind={item.current ? "fill" : "high"} size="lg" />
                <div className="rowtxt">
                  <b>{browser(item.user_agent)}</b>
                  <span>Last active {fmtDate(item.last_seen_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · expires {fmtDate(item.expires_at, { day: "numeric", month: "short" })}</span>
                  {item.user_agent ? <span className="faint" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.user_agent}</span> : null}
                </div>
                {item.current ? <Status tone="pos">This browser</Status> : <Status tone="neu">Other browser</Status>}
              </div>
            ))}
        </div>
        <div className="col-5 col sm">
          <RecordForm icon={LogOut} title="Sign out other browsers" fields={[]} submitLabel="Sign out other sessions" danger
            onSave={async () => { await api("/api/v1/auth/sessions/revoke-others/", { method: "POST" }); await query.refetch(); }}>
            <p className="t-bsm ink2">Ends every session except this one. Use it if you signed in on a shared or lost device. You stay signed in here.</p>
          </RecordForm>
          <div className="panel tight">
            <SectionTitle small icon={Shield} title="Good habits" />
            <ul className="col xs" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: "18px", color: "var(--ink-2)" }}>
              <li>Sign out on shared computers instead of just closing the tab.</li>
              <li>If you see a browser you don't recognise, sign out other sessions and change your password.</li>
              <li>Never share your password with the school; staff cannot see it and will never ask for it.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
