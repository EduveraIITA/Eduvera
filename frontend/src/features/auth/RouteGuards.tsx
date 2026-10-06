import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { authDestination, useAuth, type Portal } from "./AuthContext";

function SessionLoader() {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <span className="route-loader__mark" aria-hidden="true" />
      <span>Opening your secure workspace...</span>
    </div>
  );
}

export function RoleLanding() {
  const auth = useAuth();
  if (auth.status === "loading") return <SessionLoader />;
  return <Navigate to={authDestination(auth)} replace />;
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
    return <Navigate to="/account/security" replace />;
  }
  return children;
}

export function PortalOnly({ portal, children }: { portal: Portal; children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === "loading") return <SessionLoader />;
  if (auth.status === "anonymous") {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  if (auth.user?.email_verified === false) return <Navigate to="/account/security" replace />;
  if (!auth.hasPortal(portal)) return <Navigate to={authDestination(auth)} replace />;
  if(portal==='teacher') {
    const member=auth.memberships.find(m=>m.role==='staff');
    if(member?.custom_role) {
      if(location.pathname==='/teacher') return <Navigate to="/teacher/more" replace/>;
      const permissions:Record<string,string>={attendance:'attendance.view',classes:'attendance.view',calendar:'timetable.view',timetable:'timetable.view',messages:'messages.view',safeguarding:'safeguarding.review',events:'events.view',transport:'departure.collect',fees:'fees.manage',administration:'sis.manage',students:'sis.manage',invitations:'members.invite'};
      const section=location.pathname.split('/')[2] ?? '';
      if(permissions[section] && !member.permissions?.includes(permissions[section] ?? '')) return <Navigate to="/teacher/more" replace/>;
    }
  }
  return children;
}

export function CompanyOnly({children}:{children:ReactNode}) {
  const auth=useAuth();
  if(auth.status==='loading')return <SessionLoader/>;
  if(auth.status==='anonymous')return <Navigate to="/login?next=%2Fcompany" replace/>;
  if(!auth.companyOperator)return <Navigate to={authDestination(auth)} replace/>;
  return children;
}
