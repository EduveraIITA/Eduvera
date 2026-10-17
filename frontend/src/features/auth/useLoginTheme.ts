import { useSyncExternalStore } from "react";

function snapshot() {
  const theme = document.documentElement.getAttribute("data-theme");
  return theme === "dark" || (theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function subscribe(update: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const observer = new MutationObserver(update);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (media.addEventListener) media.addEventListener("change", update);
  else media.addListener?.(update);
  return () => {
    observer.disconnect();
    if (media.removeEventListener) media.removeEventListener("change", update);
    else media.removeListener?.(update);
  };
}
export function useLoginTheme() {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
