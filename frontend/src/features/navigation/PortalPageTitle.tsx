import { useEffect, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import "./portal-page-title.css";
import { portalParent } from "./portalHierarchy";
import {
  browserHistoryIndex,
  canPopPortalHistory,
  previousPortalLocation,
  rememberPortalLocation,
} from "./portalHistory";
import { portalReturnTarget, samePortalHref } from "./portalReturnState";

export interface PortalPageTitleProps {
  title: string;
  rootPath: string;
  backTo?: string;
  onBack?: () => void;
  beforeBack?: () => boolean | void;
  trailing?: ReactNode;
  className?: string;
}

export function PortalPageTitle({
  title,
  rootPath,
  backTo,
  onBack,
  beforeBack,
  trailing,
  className = "",
}: PortalPageTitleProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname.replace(/\/$/, "") === rootPath.replace(/\/$/, "");
  const currentHref = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    rememberPortalLocation(browserHistoryIndex(), currentHref);
  }, [currentHref]);

  const goBack = () => {
    if (beforeBack?.() === false) return;
    if (onBack) {
      onBack();
      return;
    }
    const parent = backTo ?? portalParent(location.pathname, location.search, rootPath);
    const historyIndex = browserHistoryIndex();
    const previousHref = previousPortalLocation(historyIndex);
    const explicitReturnTo = portalReturnTarget(location.state, currentHref);
    if (explicitReturnTo) {
      if (samePortalHref(previousHref, explicitReturnTo)) {
        void navigate(-1);
        return;
      }
      void navigate(explicitReturnTo, { replace: true });
      return;
    }
    if (canPopPortalHistory(currentHref, previousHref, parent)) {
      void navigate(-1);
      return;
    }
    void navigate(parent, { replace: true });
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
