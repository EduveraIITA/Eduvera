export function focusSimulationHeading(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({ behavior: "auto", block: "start", inline: "nearest" });
  }
}
