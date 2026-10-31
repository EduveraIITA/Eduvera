import { useCallback, useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";
import { previousPortalLocation } from "./portalHistory";

/** Only the app bar's already-validated, observed previous entry is a POP intent. */
export interface GuardedPopIntent {
  kind: "pop";
  fromIndex: number;
  toIndex: number;
  fromHref: string;
  toHref: string;
}

export type UnsavedChangesNavigationGuard = (intent?: GuardedPopIntent) => boolean;

function historyIndex(state: unknown) {
  if (!state || typeof state !== "object") return null;
  const index = (state as Record<string, unknown>).idx;
  return typeof index === "number" ? index : null;
}

/**
 * Guards a dirty editor across app controls, router links, browser Back/swipe,
 * and a full-page close or refresh.
 *
 * The application currently uses BrowserRouter rather than a data router, so
 * React Router's useBlocker is unavailable. Known programmatic controls call
 * the returned function; same-origin links and POP navigation are covered here
 * without altering the browser history stack.
 */
export function useUnsavedChangesGuard(when: boolean, message: string) {
  const navigation = useContext(UNSAFE_NavigationContext);
  const browserHistory = !("index" in navigation.navigator);
  const restoringPop = useRef(false);
  const currentHistoryIndex = useRef<number | null>(null);
  const allowNativeUnload = useRef(false);

  const confirmNavigation: UnsavedChangesNavigationGuard = useCallback(
    (intent?: GuardedPopIntent) => {
      if (!when) return true;
      // A validated app-bar Back is the same operation as browser Back. Let the
      // capture-phase POP listener ask once at the actual transition instead of
      // pre-authorizing a later event. A cancelled/no-op action leaves no bypass.
      if (browserHistory && intent?.kind === "pop"
        && intent.fromIndex === historyIndex(window.history.state)
        && intent.fromIndex > 0 && intent.toIndex === intent.fromIndex - 1
        && intent.fromHref === `${window.location.pathname}${window.location.search}${window.location.hash}`
        && intent.toHref === previousPortalLocation(intent.fromIndex)) return true;
      return window.confirm(message);
    },
    [browserHistory, message, when],
  );

  useEffect(() => {
    if (!when) return undefined;
    const guard = (event: BeforeUnloadEvent) => {
      if (allowNativeUnload.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [when]);

  useEffect(() => {
    if (!when) return undefined;

    const guardLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented
        || event.button !== 0
        || event.metaKey
        || event.ctrlKey
        || event.shiftKey
        || event.altKey
      ) return;

      const link = event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;

      const destination = new URL(link.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (destination.href === window.location.href) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // A native same-origin anchor unloads the document and would otherwise
      // cause a second browser prompt. React Router Link adds data-discover and
      // stays in-document, so it does not need this one-shot allowance.
      if (!link.hasAttribute("data-discover")) allowNativeUnload.current = true;
    };

    document.addEventListener("click", guardLink, true);
    return () => document.removeEventListener("click", guardLink, true);
  }, [message, when]);

  useEffect(() => {
    if (!when || !browserHistory) return undefined;
    currentHistoryIndex.current = historyIndex(window.history.state);

    const guardPop = (event: PopStateEvent) => {
      const previousIndex = currentHistoryIndex.current;
      const nextIndex = historyIndex(event.state);
      currentHistoryIndex.current = nextIndex;

      if (restoringPop.current) {
        restoringPop.current = false;
        return;
      }
      if (window.confirm(message)) return;

      // Stop React Router's normal POP listener before it can unmount this
      // editor. The restoration event is allowed through at the original entry.
      event.stopImmediatePropagation();

      const delta = previousIndex !== null && nextIndex !== null
        ? nextIndex - previousIndex
        : -1;
      restoringPop.current = true;
      currentHistoryIndex.current = previousIndex;
      window.history.go(delta === 0 ? 1 : -delta);
    };

    window.addEventListener("popstate", guardPop, true);
    return () => window.removeEventListener("popstate", guardPop, true);
  }, [browserHistory, message, when]);

  return confirmNavigation;
}
