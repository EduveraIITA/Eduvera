import { useLayoutEffect, type RefObject } from "react";

/** Safari's keyboard shrinks the visual viewport, not the layout viewport used
 * by bottom:0 / dvh. Keep the sheet inside that visible area without moving the
 * document, stealing focus, or applying a device-specific keyboard height.
 */
export function useDialogVisualViewport(ref: RefObject<HTMLDialogElement | null>) {
  useLayoutEffect(() => {
    const dialog = ref.current;
    const viewport = window.visualViewport;
    if (!dialog || !viewport) return;
    let frame = 0;
    const fit = () => {
      frame = 0;
      if (!Number.isFinite(viewport.height) || viewport.height <= 0) return;
      const top = Math.max(0, viewport.offsetTop);
      const bottom = Math.max(0, window.innerHeight - top - viewport.height);
      dialog.style.setProperty("--planner-visible-height", `${viewport.height}px`);
      dialog.style.setProperty("--planner-viewport-top", `${top}px`);
      dialog.style.setProperty("--planner-viewport-bottom", `${bottom}px`);
      dialog.dataset.keyboardVisible = String(window.innerHeight - viewport.height > 120 && viewport.scale <= 1.05);

      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !dialog.contains(active) || !active.matches("input,textarea,select,[contenteditable=true]")) return;
      const bounds = dialog.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const header = dialog.querySelector<HTMLElement>(".planner-dialog__surface > header");
      const footer = dialog.querySelector<HTMLElement>(".planner-dialog__surface > :last-child > footer");
      const footerHeight = footer && getComputedStyle(footer).position === "sticky" ? footer.getBoundingClientRect().height : 0;
      const visibleTop = Math.max(bounds.top, top) + (header?.getBoundingClientRect().height ?? 0) + 8;
      const visibleBottom = Math.min(bounds.bottom, top + viewport.height) - footerHeight - 8;
      const region = active.closest<HTMLElement>("[data-dialog-focus-region]");
      const regionBounds = region?.getBoundingClientRect();
      const target = regionBounds && regionBounds.height <= visibleBottom - visibleTop ? regionBounds : active.getBoundingClientRect();
      if (target.bottom > visibleBottom) dialog.scrollTop += target.bottom - visibleBottom;
      else if (target.top < visibleTop) dialog.scrollTop -= visibleTop - target.top;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(fit); };
    fit();
    viewport.addEventListener("resize", schedule);
    viewport.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    dialog.addEventListener("focusin", schedule);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", schedule);
      viewport.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      dialog.removeEventListener("focusin", schedule);
      for (const property of ["--planner-visible-height", "--planner-viewport-top", "--planner-viewport-bottom"]) dialog.style.removeProperty(property);
      delete dialog.dataset.keyboardVisible;
    };
  }, [ref]);
}
