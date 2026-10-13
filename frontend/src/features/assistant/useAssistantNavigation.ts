import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions } from "react-router-dom";

export function useAssistantNavigation() {
  const navigate = useNavigate();
  const transition = (selector: string, commit: () => void, after?: () => void) => {
    const update = () => new Promise<void>(resolve => {
      // BrowserRouter commits navigation concurrently. Keep the native snapshot
      // open until the destination surface actually mounts, not just until the
      // history URL changes. The timeout also allows auth redirects to finish.
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true; observer.disconnect(); window.clearTimeout(timeout); after?.(); resolve();
      };
      const check = () => { if (document.querySelector(selector)) finish(); };
      const observer = new MutationObserver(check);
      const timeout = window.setTimeout(finish, 1000);
      observer.observe(document.body, { childList: true, subtree: true });
      flushSync(commit);
      check();
    });
    if (document.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const transition = document.startViewTransition(update);
      void transition.finished.catch(() => undefined);
    } else void update();
  };
  const go = (to: string, options?: NavigateOptions, after?: () => void) => {
    const selector = /^\/(teacher|principal|parent|student)\/assistant(?:[/?#]|$)/.test(to) ? ".assistant-page" : ".assistant-dock";
    transition(selector, () => { void navigate(to, options); }, after);
  };
  return { go, fromLink: (event: MouseEvent<HTMLAnchorElement>, to: string, options?: NavigateOptions) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    event.preventDefault(); go(to, options);
  }, back: (after?: () => void) => transition(".assistant-dock", () => { void navigate(-1); }, after) };
}
