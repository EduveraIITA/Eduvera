import { PoweredBy } from "../../features/school/PoweredBy";
import { Fragment, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ProductIcon } from "../../components/ProductIcon";
import { AccountMenu } from "../../features/auth/AccountMenu";
import { useOptionalAuth } from "../../features/auth/AuthContext";
import { useProFeatures } from "../../features/auth/useProFeatures";
import { currentStaffMembership } from "../../features/auth/staffAccess";
import { NotificationCenter } from "../../features/notifications/NotificationCenter";
import { PortalPageTitle } from "../../features/navigation/PortalPageTitle";
import type { PortalPageTitleProps } from "../../features/navigation/PortalPageTitle";
import { SchoolBrand } from "../../features/school/SchoolBrand";
import { AssistantPanel, AssistantTab } from "../../features/assistant/DemoChat";
import { useDemoChat } from "../../features/assistant/useDemoChat";
import { workspaceAssignedWorkOnly, workspaceAssistantPortal } from "../../features/assistant/workspaceAssistantContext";
import { useOptionalExecutionEnvironment } from "../../features/simulation/ExecutionEnvironmentContext";
import { SimulationSessionControls } from "../../features/simulation/SimulationSessionControls";
import "./operations.css";
import "./operations-links.css";
import "./operations-brand.css";

type Portal = "teacher" | "principal";
type Active = "today" | "work" | "areas" | "home" | "attendance" | "insights" | "timetable" | "chat" | "safeguarding" | "more" | "events" | "gate";

const navigation = [
  { id: "today", label: "Today", path: "/today" },
  { id: "work", label: "Work", path: "/work" },
  { id: "areas", label: "Areas", path: "/areas" },
  { id: "more", label: "More", path: "/more" },
] as const;

type WorkspaceSection = (typeof navigation)[number]["id"];

function activeSection(pathname: string, active: Active): WorkspaceSection {
  if (pathname === "/today") return "today";
  if (pathname === "/work" || pathname.startsWith("/work/")) return "work";
  if (pathname === "/areas" || pathname.startsWith("/areas/")) return "areas";
  if (pathname === "/more" || pathname.startsWith("/more/") || pathname.startsWith("/setup/")) return "more";
  if (active === "today" || active === "work" || active === "areas") return active;
  if (active === "home") return "today";
  if (active === "more") return "more";
  return "areas";
}

export function OperationsShell({ portal, active, title, children, schoolName: selectedSchoolName, contentHasHeading = false, backTo, onBack, beforeBack, pageTitleTrailing, layout = "standard" }: { portal?: Portal; active: Active; title: string; subtitle?: string; children: ReactNode; schoolName?: string; contentHasHeading?: boolean; backTo?: string; onBack?: () => void; beforeBack?: PortalPageTitleProps["beforeBack"]; pageTitleTrailing?: ReactNode; layout?: "standard" | "immersive" | "canvas" }) {
  const auth = useOptionalAuth();
  const { pathname } = useLocation();
  const member=currentStaffMembership(auth?.memberships ?? []);
  const assistantAudience = portal ?? workspaceAssistantPortal(auth);
  const chat = useDemoChat(`${auth?.user?.id ?? "preview"}:workspace:${member?.school_id ?? auth?.user?.active_school_id ?? ""}`);
  const proFeatures = useProFeatures();
  const executionEnvironment = useOptionalExecutionEnvironment();
  const assistantEnabled = !workspaceAssignedWorkOnly(auth) && proFeatures.enabled && assistantAudience !== null && executionEnvironment?.mode !== "simulation";
  const assistantActive = assistantEnabled && chat.active;
  const assistantOpen = assistantEnabled && chat.open;
  const section = activeSection(pathname, active);
  const primaryDestination = navigation.some(({ path }) => path === pathname);
  const schoolName = selectedSchoolName ?? auth?.memberships[0]?.school_name ?? "School";
  const canvasLayout = layout === "canvas";
  return (
    <div className={`operations-app operations-app--workspace${contentHasHeading ? " operations-app--content-heading" : ""}${layout !== "standard" ? ` operations-app--${layout}` : ""}`}>
      {!canvasLayout ? <aside className="operations-sidebar">
        <SchoolBrand name={schoolName} className="operations-brand" />
        <nav aria-label="Workspace">
          {navigation.map(({ id, label, path }, index) => <Fragment key={id}>
            {assistantEnabled && index === 2 ? <AssistantTab chat={chat} sidebar /> : null}
            <NavLink to={path} end aria-label={label} aria-current={!assistantActive && section === id ? "page" : undefined}
              className={!assistantActive && section === id ? "is-active" : ""}>
              <ProductIcon name={id} size={25} /><span>{label}</span>
            </NavLink>
          </Fragment>)}
        </nav>
        <div className="operations-sidebar__scope"><span>Your workspace</span><strong>{schoolName}</strong><small>Tools available through your responsibilities.</small></div>
        <PoweredBy />
      </aside> : null}
      <div className="operations-workspace">
        {!canvasLayout ? <header className="operations-topbar">
          <SchoolBrand name={schoolName} className="operations-topbar__brand" />
          <div className="operations-topbar__heading"><PortalPageTitle title={title} rootPath={primaryDestination ? pathname : "/today"} backTo={backTo} onBack={onBack} beforeBack={beforeBack} trailing={pageTitleTrailing} contentHasHeading={contentHasHeading} /></div>
          <div className="operations-topbar__actions"><NotificationCenter buttonClassName="operations-icon-button" iconSize={20} /><AccountMenu buttonClassName="operations-profile-button" ariaLabel="Open account" iconSize={20} /></div>
        </header> : null}
        {!canvasLayout ? <SimulationSessionControls schoolId={member?.school_id ?? auth?.user?.active_school_id ?? undefined} /> : null}
        <main className="operations-main" inert={!canvasLayout && assistantOpen}>{children}{!canvasLayout && active === "home" ? <PoweredBy className="powered-by--home" /> : null}</main>
        {!canvasLayout && assistantEnabled && assistantAudience ? <AssistantPanel chat={chat} context={{ portal: assistantAudience, pageTitle: title, permissions: member?.permissions }} /> : null}
        {!canvasLayout && !(assistantEnabled && chat.fullPage) ? <nav className="operations-mobile-nav" aria-label="Workspace">
          {navigation.map(({ id, label, path }, index) => <Fragment key={id}>
            {assistantEnabled && index === 2 ? <AssistantTab chat={chat} /> : null}
            <NavLink to={path} end aria-label={label} aria-current={!assistantActive && section === id ? "page" : undefined}
              className={!assistantActive && section === id ? "is-active" : ""}>
              <ProductIcon name={id} size={25} /><span>{label}</span>
            </NavLink>
          </Fragment>)}
        </nav> : null}
      </div>
    </div>
  );
}
