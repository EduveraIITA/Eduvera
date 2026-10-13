import { useId, useRef, useState, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";

const assistantReopenKey = "omnischool:assistant-reopen";

export function requestAssistantReopen(href: string) {
  try { window.sessionStorage.setItem(assistantReopenKey, href); } catch { /* Storage may be unavailable in private contexts. */ }
}

function consumeAssistantReopen(href: string) {
  try {
    if (window.sessionStorage.getItem(assistantReopenKey) !== href) return false;
    window.sessionStorage.removeItem(assistantReopenKey);
    return true;
  } catch { return false; }
}

export function useDemoChat(scope: string) {
  const location = useLocation();
  const key = `${scope}:${location.key}:${location.pathname}:${location.search}`;
  const href = `${location.pathname}${location.search}`;
  const stateRequestsReopen = Boolean((location.state as { assistantReopen?: boolean } | null)?.assistantReopen);
  const [openKey, setOpenKey] = useState<string | undefined>(() => stateRequestsReopen || consumeAssistantReopen(href) ? key : undefined);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const fullPage = /^\/(teacher|principal|parent|student)\/assistant\/?$/.test(location.pathname);
  const close = () => { setOpenKey(undefined); trigger.current?.focus(); };
  return {
    id, key, fullPage, active: fullPage || openKey === key, open: !fullPage && openKey === key,
    toggle: (event: MouseEvent<HTMLButtonElement>) => {
      trigger.current = event.currentTarget;
      if (fullPage) { document.querySelector<HTMLTextAreaElement>(".assistant-page__composer textarea")?.focus(); return; }
      setOpenKey(current => current === key ? undefined : key);
    },
    close,
  };
}
export type DemoChatControl = ReturnType<typeof useDemoChat>;
