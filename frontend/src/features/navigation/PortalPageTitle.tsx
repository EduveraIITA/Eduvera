import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import "./portal-page-title.css";
import { portalParent } from "./portalHierarchy";

export interface PortalPageTitleProps {
  title: string;
  rootPath: string;
  backTo?: string;
  onBack?: () => void;
  trailing?: ReactNode;
  className?: string;
}

export function PortalPageTitle({
  title,
  rootPath,
  backTo,
  onBack,
  trailing,
  className = "",
}: PortalPageTitleProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname.replace(/\/$/, "") === rootPath.replace(/\/$/, "");

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (backTo) {
      void navigate(backTo);
      return;
    }
    void navigate(portalParent(location.pathname, location.search, rootPath));
  };

  return (
    <div className={`portal-page-title ${className}`.trim()}>
      {!isRoot ? (
        <button className="portal-page-title__back" type="button" aria-label="Go back" onClick={goBack}>
          <ArrowLeft size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      <h1 className="portal-page-title__text">{title}</h1>
      {trailing ? <div className="portal-page-title__trailing">{trailing}</div> : null}
    </div>
  );
}
