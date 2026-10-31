import { useEffect, useRef, type RefObject } from "react";

/** CSS immersive mode keeps the map and its camera mounted; no browser fullscreen permission. */
export function useCampusMapImmersive(expanded: boolean, toggleRef: RefObject<HTMLButtonElement | null>, onExpandedChange?: (value: boolean) => void) {
  const callback = useRef(onExpandedChange);
  useEffect(() => { callback.current = onExpandedChange; }, [onExpandedChange]);
  useEffect(() => {
    callback.current?.(expanded);
    if (!expanded) return;
    const overflow = document.body.style.overflow;
    const position = { x: window.scrollX, y: window.scrollY };
    document.body.style.overflow = "hidden";
    const toggle = toggleRef.current;
    toggle?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      callback.current?.(false);
      if (position.x !== window.scrollX || position.y !== window.scrollY) window.scrollTo(position.x, position.y);
      if (toggle?.isConnected) toggle.focus({ preventScroll: true });
    };
  }, [expanded, toggleRef]);
}
