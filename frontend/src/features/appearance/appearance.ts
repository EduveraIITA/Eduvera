import { useSyncExternalStore } from "react";

export const APPEARANCE_STORAGE_KEY = "thatcampus:appearance";

import type { AppearancePreference, ResolvedAppearance } from "../../../../packages/contracts/src/appearance";
export type { AppearancePreference, ResolvedAppearance } from "../../../../packages/contracts/src/appearance";

export interface AppearanceSnapshot {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
}

const listeners = new Set<() => void>();
const fallbackSnapshot: AppearanceSnapshot = { preference: "system", resolved: "light" };
let snapshot = fallbackSnapshot;
let initialized = false;
let mediaQuery: MediaQueryList | null = null;

function isPreference(value: unknown): value is AppearancePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readStoredPreference(): AppearancePreference {
  try {
    const stored = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemAppearance(): ResolvedAppearance {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolvedAppearance(preference: AppearancePreference): ResolvedAppearance {
  return preference === "system" ? systemAppearance() : preference;
}

function applyToDocument(resolved: ResolvedAppearance) {
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  let themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!themeColor) {
    themeColor = document.createElement("meta");
    themeColor.name = "theme-color";
    document.head.append(themeColor);
  }
  themeColor.content = resolved === "dark" ? "#0e1520" : "#f8f9ff";
  // Browser favicons follow appearance; installed Home Screen art must not.
  // One opaque tile stays readable after the OS changes its own theme, even
  // when it retains the bitmap selected at install time.
  for (const [selector, rel, href] of [
    ['link[data-brand-favicon]', 'icon', `/icons/thatcampus-favicon-${resolved}-v3.png`],
    ['link[rel="apple-touch-icon"]', 'apple-touch-icon', '/icons/thatcampus-touch-v4.png'],
    ['link[rel="manifest"]', 'manifest', '/icons/manifest-v4.webmanifest'],
  ] as const) {
    let link = document.querySelector<HTMLLinkElement>(selector);
    if (!link) {
      link = document.createElement("link");
      link.rel = rel;
      if (rel === "icon") { link.dataset.brandFavicon = ""; link.type = "image/png"; }
      document.head.append(link);
    }
    if (rel === "apple-touch-icon") link.setAttribute("sizes", "180x180");
    link.setAttribute("href", href);
  }
}

function publish(preference: AppearancePreference) {
  const next: AppearanceSnapshot = { preference, resolved: resolvedAppearance(preference) };
  if (snapshot.preference === next.preference && snapshot.resolved === next.resolved) {
    applyToDocument(next.resolved);
    return;
  }
  snapshot = next;
  applyToDocument(next.resolved);
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent) {
  if (event.key !== APPEARANCE_STORAGE_KEY) return;
  publish(isPreference(event.newValue) ? event.newValue : "system");
}

function handleSystemAppearance() {
  if (snapshot.preference === "system") publish("system");
}

export function initializeAppearance() {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  if (initialized) {
    applyToDocument(snapshot.resolved);
    return;
  }
  initialized = true;
  mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  publish(readStoredPreference());
  window.addEventListener("storage", handleStorage);
  if (mediaQuery.addEventListener) mediaQuery.addEventListener("change", handleSystemAppearance);
  else mediaQuery.addListener?.(handleSystemAppearance);
}

export function setAppearance(preference: AppearancePreference) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  initializeAppearance();
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
  } catch {
    // Private browsing and embedded webviews can deny storage. The in-memory
    // preference still applies for the rest of this page session.
  }
  publish(preference);
}

function subscribe(listener: () => void) {
  initializeAppearance();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export function useAppearance() {
  return useSyncExternalStore(subscribe, getSnapshot, () => fallbackSnapshot);
}
