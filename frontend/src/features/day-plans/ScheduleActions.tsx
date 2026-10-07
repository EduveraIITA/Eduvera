import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export function ScheduleActions({ children }: { children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current) {
        menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return <details ref={menu} className="day-schedule-menu" onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.currentTarget.open = false;
      event.currentTarget.querySelector("summary")?.focus();
    }
  }} onBlur={(event) => {
    // Safari does not focus tapped buttons. A null target can be a tap INSIDE
    // the menu, so let pointerdown handle outside taps before dismissing it.
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.open = false;
    }
  }}>
    <summary aria-label="Schedule actions"><MoreHorizontal size={21} aria-hidden="true" /></summary>
    <div className="day-schedule-menu__items">{children}</div>
  </details>;
}
