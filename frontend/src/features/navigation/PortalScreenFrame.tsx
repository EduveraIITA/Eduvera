import { type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { isSecondaryPortalPage } from "./portalHierarchy";
import { RouteScrollRestoration } from "./RouteScrollRestoration";
import { useOptionalExecutionEnvironment } from "../simulation/ExecutionEnvironmentContext";
import { executionEnvironmentIdentity } from "../simulation/executionEnvironment";
import "./secondary-screens.css";
import "./focused-workspaces.css";

export function PortalScreenFrame({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { pathname } = useLocation();
  const environment = useOptionalExecutionEnvironment();
  const campus = auth.user?.active_school_id ?? auth.memberships[0]?.school_id ?? environment?.institutionId ?? "personal";
  const scope = auth.status === "authenticated" && auth.user ? `${auth.user.id}:${campus}:${environment ? executionEnvironmentIdentity(environment) : "unavailable"}` : null;
  const secondary = isSecondaryPortalPage(pathname);
  return <div className={`app-viewport${secondary ? " portal-secondary-screen" : ""}`}>
    <RouteScrollRestoration scopeKey={scope} requireCommitMarker />
    {children}
    {auth.publicDemo ? <aside className="public-demo-banner" role="status"><span><b>Public demo</b> · sample data · read-only</span><a href="/account/profile?demo_profiles=1">Switch profile</a><button type="button" onClick={() => void auth.logout()}>Exit</button></aside> : null}
  </div>;
}
