import { ArrowRight, Info, LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import { useOptionalAuth, type Portal } from "../auth/AuthContext";
import { toolsFor, type Tool } from "./tools";
import "./more.css";

function ToolTile({ tool }: { tool: Tool }) {
  const Icon = tool.icon;
  const status = tool.path ? null : <span className="more-status"><LockKeyhole size={11} />{tool.planned === "desktop" ? "Desktop" : "Planned"}</span>;
  const body = <>
    <div className="more-tile__top"><span className="more-tile__icon"><Icon size={21} /></span>{status}</div>
    <h3>{tool.name}</h3>
    <p>{tool.description}</p>
    {tool.path ? <em>Open <ArrowRight size={14} /></em> : <em>{tool.planned === "desktop" ? "Available on the desktop app today" : "Coming in a future release"}</em>}
  </>;
  if (tool.path) return <Link className={`more-tile more-tile--${tool.tone}`} to={tool.path} aria-label={`Open ${tool.name}`}>{body}</Link>;
  return <article className={`more-tile more-tile--${tool.tone} more-tile--planned`}>{body}</article>;
}

/* The tool catalogue itself; the shell around it is chosen per portal below. */
export function MoreContent({ portal }: { portal: Portal }) {
  const auth=useOptionalAuth();
  const member=auth?.memberships.find(m=>m.role==='staff');
  const needed:Record<string,string>={classes:'attendance.view',registers:'attendance.view',weekly:'timetable.view',calendar:'timetable.view',messages:'messages.view',events:'events.view',safeguarding:'safeguarding.review'};
  const tools = toolsFor(portal).filter(tool=>portal!=='teacher' || !member?.custom_role || !needed[tool.id] || member.permissions?.includes(needed[tool.id] ?? ""));
  if(portal==='teacher' && member?.permissions?.includes('fees.manage')) tools.push({id:'delegated-fees',name:'Fee ledger',description:'Delegated fee and receipt access',icon:LockKeyhole,tone:'amber',path:'/teacher/fees'});
  if(portal==='teacher' && member?.permissions?.includes('sis.manage')) tools.push({id:'delegated-office',name:'School administration',description:'Delegated school office access',icon:LockKeyhole,tone:'blue',path:'/teacher/administration'});
  if(portal==='principal' || (portal==='teacher' && member?.permissions?.includes('members.invite'))) tools.unshift({id:'member-invitations',name:'Invite members',description:'Invite staff, students and guardians',icon:LockKeyhole,tone:'blue',path:`/${portal}/invitations`});
  const live = tools.filter((t) => t.path);
  const planned = tools.filter((t) => !t.path);
  return (
    <div className="more-page">
      {portal==='teacher' && member?.custom_role ? <p role="status">Your role: <strong>{member.custom_role.name}</strong></p> : null}
      <section className="more-section" aria-labelledby="more-tools-title">
        <header><div><h2 id="more-tools-title">Tools</h2></div><b>{live.length} available</b></header>
        <div className="more-grid">{live.map((tool) => <ToolTile key={tool.id} tool={tool} />)}</div>
      </section>
      {planned.length ? (
        <section className="more-section" aria-labelledby="more-planned-title">
          <header><div><h2 id="more-planned-title">Coming to mobile</h2></div></header>
          <div className="more-grid">{planned.map((tool) => <ToolTile key={tool.id} tool={tool} />)}</div>
          <div className="more-note"><Info size={16} /><span>These tools need a wider screen today. Mobile versions will appear here when they are ready.</span></div>
        </section>
      ) : null}
    </div>
  );
}

function Shell({ portal, children }: { portal: Portal; children: ReactNode }) {
  if (portal === "parent") return <ParentShell active="more" pageLabel="More">{children}</ParentShell>;
  return <OperationsShell portal={portal === "teacher" ? "teacher" : "principal"} active="more" title="More">{children}</OperationsShell>;
}

export function ParentMoreRoute() { return <Shell portal="parent"><MoreContent portal="parent" /></Shell>; }
export function TeacherMoreRoute() { return <Shell portal="teacher"><MoreContent portal="teacher" /></Shell>; }
export function PrincipalMoreRoute() { return <Shell portal="principal"><MoreContent portal="principal" /></Shell>; }
