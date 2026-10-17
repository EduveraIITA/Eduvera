import { useSyncExternalStore } from "react";

function snapshot() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function subscribe(update: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media.addEventListener("change", update);
  return () => { observer.disconnect(); media.removeEventListener("change", update); };
}
export function useLoginTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
