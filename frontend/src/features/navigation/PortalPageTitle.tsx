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
import type { GuardedPopIntent } from "./useUnsavedChangesGuard";

export interface PortalPageTitleProps {
  title: string;
  rootPath: string;
  backTo?: string;
  onBack?: () => void;
  beforeBack?: (intent?: GuardedPopIntent) => boolean | void;
  trailing?: ReactNode;
  className?: string;
  /** The domain content owns its visible H1; retain only the back affordance here. */
  contentHasHeading?: boolean;
}

export function PortalPageTitle({
  title,
  rootPath,
  backTo,
  onBack,
  beforeBack,
  trailing,
  className = "",
  contentHasHeading = false,
}: PortalPageTitleProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isRoot = location.pathname.replace(/\/$/, "") === rootPath.replace(/\/$/, "");
  const currentHref = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    rememberPortalLocation(browserHistoryIndex(), currentHref);
  }, [currentHref]);

  const goBack = () => {
    if (onBack) {
      if (beforeBack?.() === false) return;
      onBack();
      return;
    }
    const parent = backTo ?? portalParent(location.pathname, location.search, rootPath);
    const historyIndex = browserHistoryIndex();
    const previousHref = previousPortalLocation(historyIndex);
    const explicitReturnTo = portalReturnTarget(location.state, currentHref);
    const popToPrevious = explicitReturnTo
      ? samePortalHref(previousHref, explicitReturnTo)
      : canPopPortalHistory(currentHref, previousHref, parent);
    const popIntent: GuardedPopIntent | undefined = popToPrevious && historyIndex !== null && previousHref
      ? { kind: "pop", fromIndex: historyIndex, toIndex: historyIndex - 1, fromHref: currentHref, toHref: previousHref }
      : undefined;
    if (beforeBack?.(popIntent) === false) return;
    if (explicitReturnTo) {
      if (popToPrevious) {
        void navigate(-1);
        return;
      }
      void navigate(explicitReturnTo, { replace: true });
      return;
    }
    if (popToPrevious) {
      void navigate(-1);
      return;
    }
    void navigate(parent, { replace: true });
  };

  return (
    <div className={`portal-page-title${trailing ? " portal-page-title--with-actions" : ""} ${className}`.trim()}>
      {!isRoot ? (
        <button className="portal-page-title__back" type="button" aria-label="Go back" onClick={goBack}>
          <ArrowLeft size={20} strokeWidth={2.2} aria-hidden="true" />
        </button>
      ) : null}
      {contentHasHeading ? <span className="sr-only">{title}</span> : <h1 className="portal-page-title__text">{title}</h1>}
      {trailing ? <div className="portal-page-title__trailing">{trailing}</div> : null}
    </div>
  );
}
