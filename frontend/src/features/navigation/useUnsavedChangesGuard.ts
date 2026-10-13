import { useCallback, useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

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

  const confirmNavigation = useCallback(
    () => !when || window.confirm(message),
    [message, when],
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

      const delta = previousIndex !== null && nextIndex !== null
        ? nextIndex - previousIndex
        : -1;
      restoringPop.current = true;
      currentHistoryIndex.current = previousIndex;
      window.history.go(delta === 0 ? 1 : -delta);
    };

    window.addEventListener("popstate", guardPop);
    return () => window.removeEventListener("popstate", guardPop);
  }, [browserHistory, message, when]);

  return confirmNavigation;
}
