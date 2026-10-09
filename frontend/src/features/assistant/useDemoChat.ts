import { useId, useRef, useState, type MouseEvent } from "react";
import { useLocation } from "react-router-dom";

export function useDemoChat(scope: string) {
  const location = useLocation();
  const key = `${scope}:${location.key}:${location.pathname}:${location.search}`;
  const [openKey, setOpenKey] = useState<string | undefined>(() => (location.state as { assistantReopen?: boolean } | null)?.assistantReopen ? key : undefined);
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
