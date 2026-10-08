import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { isSecondaryPortalPage } from "./portalHierarchy";
import "./secondary-screens.css";
import "./focused-workspaces.css";

export function PortalScreenFrame({ children }: { children: ReactNode }) {
  const { pathname, search } = useLocation();
  const secondary = isSecondaryPortalPage(pathname);
  const params = new URLSearchParams(search);
  const detailKey = ["assessment", "batch", "scheme", "policy", "section", "edit", "student", "guardian", "create", "mode", "view", "invoice", "case", "import", "rule", "report"].map(key => params.get(key)).join(":");
  useEffect(() => {
    if (secondary) window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname, detailKey, secondary]);
  return <div className={`app-viewport${secondary ? " portal-secondary-screen" : ""}`}>{children}</div>;
}
