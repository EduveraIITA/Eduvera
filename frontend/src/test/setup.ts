import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";

// Route tests load auth, a lazy page and its action data in sequence. Give CI's
// slower shared runners time for those observable transitions before failing.
configure({ asyncUtilTimeout: 5_000 });
Object.defineProperty(window, "scrollTo", { writable: true, value: () => undefined });

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
