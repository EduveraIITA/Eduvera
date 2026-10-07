function isStandaloneDisplay(): boolean {
  const navigatorWithStandalone = window.navigator as Navigator & { standalone?: boolean };
  return navigatorWithStandalone.standalone === true
    || window.matchMedia("(display-mode: standalone)").matches
    || window.matchMedia("(display-mode: fullscreen)").matches;
}

function isPlainPrimaryClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function findAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest("a[href]") : null;
}

export function installStandaloneNavigationGuard(): void {
  if (typeof window === "undefined" || !isStandaloneDisplay()) return;

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || !isPlainPrimaryClick(event)) return;

    const anchor = findAnchor(event.target);
    if (!anchor || anchor.target || anchor.hasAttribute("download")) return;

    const rawHref = anchor.getAttribute("href");
    if (!rawHref || rawHref.startsWith("#")) return;

    const destination = new URL(anchor.href, window.location.href);
    if (destination.origin !== window.location.origin) return;
    if (destination.protocol !== "http:" && destination.protocol !== "https:") return;

    const next = `${destination.pathname}${destination.search}${destination.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;

    event.preventDefault();
    window.history.pushState({}, "", next);
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state as unknown }));
  });
}
