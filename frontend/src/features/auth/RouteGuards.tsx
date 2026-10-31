import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authDestination, useAuth } from "./AuthContext";
import { ThatCampusLoader } from "../../components/ThatCampusLoader";

function SessionLoader() {
  return <ThatCampusLoader label="Opening your secure workspace…" />;
}

function securityRedirect(location: ReturnType<typeof useLocation>) {
  const origin = `${location.pathname}${location.search}`;
  return <Navigate
    to={`/account/security?from=${encodeURIComponent(origin)}`}
    state={{ accountReturnTo: origin, accountCanPop: false }}
    replace
  />;
}

export function RoleLanding() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <SessionLoader />;
  const request=new URLSearchParams(location.search).get('visitor_request');
  const visitorRequest=request&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(request)?request:null;
  const destination=new URL(authDestination(auth,{resumeUnfinishedSetup:!visitorRequest}),"https://thatcampus.invalid");
  if(visitorRequest)destination.searchParams.set('visitor_request',visitorRequest);
  return <Navigate to={`${destination.pathname}${destination.search}`} replace />;
}

export function PublicOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <SessionLoader />;
  if (auth.status === "authenticated") {
    const requestedPath = new URLSearchParams(location.search).get("next");
    const safePath = requestedPath?.startsWith("/") && !requestedPath.startsWith("//")
      ? requestedPath
      : authDestination(auth);
    return <Navigate to={safePath} replace />;
  }
  return children;
}

export function AuthenticatedOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <SessionLoader />;
  if (auth.status === "anonymous") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (auth.user?.email_verified === false && location.pathname !== "/account/security") {
    return securityRedirect(location);
  }
  return children;
}

/**
 * Transitional protection for institution workspaces.
 *
 * Membership proves only that the account has a relationship with an
 * institution. It deliberately does not grant operational authority from a
 * role label; each domain API remains responsible for capability and scope
 * authorization.
 */
export function WorkspaceOnly({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <SessionLoader />;
  if (auth.status === "anonymous") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (auth.user?.email_verified === false) return securityRedirect(location);
  if (auth.memberships.length === 0) return <Navigate to={authDestination(auth)} replace />;
  return children;
}

export function CompanyOnly({children}:{children:ReactNode}) {
  const auth=useAuth();
  if(auth.status==='loading')return <SessionLoader/>;
  if(auth.status==='anonymous')return <Navigate to="/login?next=%2Fcompany" replace/>;
  if(!auth.companyOperator)return <Navigate to={authDestination(auth)} replace/>;
  return children;
}
