import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

function expectInstallMetadata(documentToCheck = document) {
  expect(documentToCheck.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href")).toBe("/icons/thatcampus-touch-v4.png");
  expect(documentToCheck.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("sizes")).toBe("180x180");
  expect(documentToCheck.querySelector('link[rel="manifest"]')?.getAttribute("href")).toBe("/icons/manifest-v4.webmanifest");
}

function installMedia(dark: boolean, legacy = false) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    addListener: (listener: () => void) => listeners.add(listener),
    removeListener: (listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  } as MediaQueryList;
  if (legacy) Object.defineProperty(media, "addEventListener", { value: undefined });
  vi.spyOn(window, "matchMedia").mockReturnValue(media);
  return { media, notify: () => listeners.forEach((listener) => listener()) };
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.head.querySelectorAll('link[data-brand-favicon],link[rel="apple-touch-icon"],link[rel="manifest"]').forEach((link) => link.remove());
});

afterEach(() => vi.restoreAllMocks());

it("defaults to the system preference and follows system changes", async () => {
  const system = installMedia(false);
  const { initializeAppearance } = await import("./appearance");
  initializeAppearance();
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expectInstallMetadata();

  Object.defineProperty(system.media, "matches", { configurable: true, value: true });
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(document.documentElement.style.colorScheme).toBe("dark");
  expect(document.querySelector('meta[name="theme-color"]')).toHaveAttribute("content", "#0e1520");
  expect(document.querySelector('link[data-brand-favicon]')).toHaveAttribute("href", "/icons/thatcampus-favicon-dark-v3.png");
  expectInstallMetadata();

  Object.defineProperty(system.media, "matches", { configurable: true, value: false });
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(document.querySelector('link[data-brand-favicon]')).toHaveAttribute("href", "/icons/thatcampus-favicon-light-v3.png");
  expectInstallMetadata();
});

it("keeps explicit Light and Dark choices independent from live device changes, then resumes System", async () => {
  const system = installMedia(true);
  window.localStorage.setItem("thatcampus:appearance", "light");
  document.documentElement.dataset.executionEnvironment = "simulation";
  const { initializeAppearance, setAppearance } = await import("./appearance");
  initializeAppearance();
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expect(document.querySelector('link[data-brand-favicon]')).toHaveAttribute("href", "/icons/thatcampus-favicon-light-v3.png");
  expectInstallMetadata();
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "light");

  setAppearance("dark");
  Object.defineProperty(system.media, "matches", { configurable: true, value: false });
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(document.querySelector('link[data-brand-favicon]')).toHaveAttribute("href", "/icons/thatcampus-favicon-dark-v3.png");
  expectInstallMetadata();

  setAppearance("system");
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expectInstallMetadata();
  Object.defineProperty(system.media, "matches", { configurable: true, value: true });
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expectInstallMetadata();
  expect(window.localStorage.getItem("thatcampus:appearance")).toBe("system");
  expect(document.documentElement).toHaveAttribute("data-execution-environment", "simulation");
  document.documentElement.removeAttribute("data-execution-environment");
});

it("follows device changes through the legacy MediaQueryList listener supported by older webviews", async () => {
  const system = installMedia(false, true);
  const { initializeAppearance } = await import("./appearance");
  initializeAppearance();
  Object.defineProperty(system.media, "matches", { configurable: true, value: true });
  system.notify();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expectInstallMetadata();
});

it("persists same-tab changes and accepts cross-tab storage updates", async () => {
  installMedia(false);
  const { APPEARANCE_STORAGE_KEY, initializeAppearance, setAppearance } = await import("./appearance");
  initializeAppearance();
  setAppearance("dark");
  expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");

  window.dispatchEvent(new StorageEvent("storage", { key: APPEARANCE_STORAGE_KEY, newValue: "light" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "light");
  expectInstallMetadata();
});

it("still applies an in-memory choice when storage is denied", async () => {
  installMedia(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("Denied"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied"); });
  const { initializeAppearance, setAppearance } = await import("./appearance");
  expect(() => initializeAppearance()).not.toThrow();
  expect(() => setAppearance("dark")).not.toThrow();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expectInstallMetadata();
});

it.each([
  { preference: "system", darkDevice: false, resolved: "light" },
  { preference: "system", darkDevice: true, resolved: "dark" },
  { preference: "light", darkDevice: true, resolved: "light" },
  { preference: "dark", darkDevice: false, resolved: "dark" },
])("keeps install art invariant before first paint with $preference on darkDevice=$darkDevice", ({ preference, darkDevice, resolved }) => {
  const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const page = new DOMParser().parseFromString(html, "text/html");
  const bootstrap = page.querySelector("script")?.textContent;
  if (!bootstrap) throw new Error("The first-paint appearance bootstrap is missing.");
  // The static no-JavaScript document uses the same safe install metadata.
  expectInstallMetadata(page);
  runInNewContext(bootstrap, {
    document: page,
    window: { localStorage: { getItem: () => preference }, matchMedia: () => ({ matches: darkDevice }) },
  });
  expect(page.documentElement.getAttribute("data-theme")).toBe(resolved);
  expect(page.querySelector('link[data-brand-favicon]')?.getAttribute("href")).toBe(`/icons/thatcampus-favicon-${resolved}-v3.png`);
  expect(page.querySelector('link[data-brand-no-script]')).toBeNull();
  expectInstallMetadata(page);
});
