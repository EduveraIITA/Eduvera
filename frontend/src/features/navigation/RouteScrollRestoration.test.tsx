import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { lazy, StrictMode, Suspense, type ComponentType } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { RouteScrollCommitMarker, RouteScrollRestoration } from "./RouteScrollRestoration";
import { previousPortalLocation, rememberPortalLocation, resetRememberedPortalHistory } from "./portalHistory";

const pageHeight = 4_000;
const viewportHeight = 800;
let documentHeight = pageHeight;
let scrollPosition = 0;
let nextFrameId = 0;
let scrollToSpy: MockInstance<typeof window.scrollTo>;
const frames = new Map<number, FrameRequestCallback>();
const observerNotifications = new Set<() => void>();
const originalDescriptors = new Map<object, Map<string, PropertyDescriptor | undefined>>();

function define(target: object, property: string, descriptor: PropertyDescriptor) {
  const originals = originalDescriptors.get(target) ?? new Map<string, PropertyDescriptor | undefined>();
  if (!originals.has(property)) originals.set(property, Object.getOwnPropertyDescriptor(target, property));
  originalDescriptors.set(target, originals);
  Object.defineProperty(target, property, { configurable: true, ...descriptor });
}

class TestMutationObserver {
  private readonly notify: () => void;
  constructor(callback: MutationCallback) { this.notify = () => callback([], this); }
  observe() { observerNotifications.add(this.notify); }
  disconnect() { observerNotifications.delete(this.notify); }
  takeRecords() { return []; }
}

class TestResizeObserver {
  private readonly notify: () => void;
  constructor(callback: ResizeObserverCallback) { this.notify = () => callback([], this); }
  observe() { observerNotifications.add(this.notify); }
  unobserve() { observerNotifications.delete(this.notify); }
  disconnect() { observerNotifications.delete(this.notify); }
}

function flushFrames(count = 3) {
  act(() => {
    for (let frame = 0; frame < count; frame += 1) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach(callback => callback(performance.now()));
    }
  });
}

function resizeDocument(height: number) {
  documentHeight = height;
  act(() => { [...observerNotifications].forEach(notify => notify()); });
  flushFrames();
}

function userScroll(top: number) {
  scrollPosition = Math.max(0, Math.min(top, documentHeight - viewportHeight));
  fireEvent.scroll(window);
}

function NavigationControls() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output aria-label="Current route">{location.pathname}{location.search}{location.hash}</output>
    <button onClick={() => navigate("/areas")}>Areas</button>
    <button onClick={() => navigate("/areas/dining")}>Dining</button>
    <button onClick={() => navigate("/areas/resources")}>Resources</button>
    <button onClick={() => navigate("/areas/resources?status=available")}>Available resources</button>
    <button onClick={() => navigate("/areas/resources?item=resource-1")}>Resource detail</button>
    <button onClick={() => navigate("/areas/resources?item=resource-1&tab=history")}>Resource history</button>
    <button onClick={() => navigate("/areas/resources?item=resource-2")}>Another resource</button>
    <button onClick={() => navigate("/areas/resources?status=available")}>Resource list back</button>
    <button className="portal-page-title__back" onClick={() => navigate("/areas/resources?status=available")}>
      Back to resource list
    </button>
    <button onClick={() => navigate("/areas/resources#repair%20queue")}>Repair queue anchor</button>
    <button onClick={() => navigate("/areas/dining?date=2026-10-26&view=day&session_id=lunch")}>Dining session</button>
    <button onClick={() => navigate("/areas/dining?date=2026-10-26&view=day&session_id=lunch&issue_id=shortage")}>Dining issue</button>
    <button onClick={() => navigate("/areas/dining?date=2026-10-26&view=day&session_id=lunch")}>Dining session back</button>
    <button onClick={() => navigate("/areas/dining?date=2026-10-26&view=day")}>Dining date back</button>
    <button onClick={() => navigate("/areas/calendar?date=2026-10-26")}>Calendar Monday</button>
    <button onClick={() => navigate("/areas/calendar?date=2026-10-27")}>Calendar Tuesday</button>
    <button onClick={() => navigate("/areas/calendar?date=2026-10-26", { replace: true })}>Replace Monday</button>
    <button onClick={() => navigate("/areas/calendar?date=2026-10-27", { replace: true })}>Replace Tuesday</button>
    {(["student", "guardian", "assessment_id", "report_batch_id"] as const).map(selector => <button key={selector} onClick={() => {
      const params = new URLSearchParams(location.search);
      params.set(selector, `${selector}-1`);
      if (selector === "assessment_id") params.set("publication_id", "publication-1");
      void navigate(`${location.pathname}?${params}`);
    }}>Open {selector} detail</button>)}
    <button onClick={() => navigate(-1)}>Back</button>
    <button onClick={() => navigate(1)}>Forward</button>
  </>;
}

function TestApplication({ scopeKey, initialPath }: { scopeKey: string | null; initialPath: string }) {
  return <MemoryRouter initialEntries={[initialPath]}>
    <RouteScrollRestoration scopeKey={scopeKey} />
    <NavigationControls />
  </MemoryRouter>;
}

function DiningTestPage() { return <h1>Dining content</h1>; }

function CommitAwareApplication({ DiningPage = DiningTestPage, loadingParent = false, useTransitions = true }: { DiningPage?: ComponentType; loadingParent?: boolean; useTransitions?: boolean }) {
  return <MemoryRouter initialEntries={["/areas"]} useTransitions={useTransitions}>
    <RouteScrollRestoration scopeKey="person-1:campus-1:live" requireCommitMarker />
    <NavigationControls />
    <Suspense fallback={<p role="status">Loading destination</p>}>
      <RouteScrollCommitMarker />
      <Routes>
        <Route path="/areas" element={<main className="responsibility-workspace" aria-busy={loadingParent}><h1>Areas content</h1></main>} />
        <Route path="/areas/dining" element={<DiningPage />} />
      </Routes>
    </Suspense>
  </MemoryRouter>;
}

function mount(initialPath = "/areas", scopeKey: string | null = "person-1:campus-1:live") {
  const rendered = render(<TestApplication scopeKey={scopeKey} initialPath={initialPath} />);
  flushFrames();
  return {
    ...rendered,
    changeScope(nextScope: string | null) {
      rendered.rerender(<TestApplication scopeKey={nextScope} initialPath={initialPath} />);
      flushFrames();
    },
  };
}

function go(button: string) {
  fireEvent.click(screen.getByRole("button", { name: button, exact: true }));
  flushFrames();
}

beforeEach(() => {
  vi.useFakeTimers();
  documentHeight = pageHeight;
  scrollPosition = 0;
  nextFrameId = 0;
  frames.clear();
  observerNotifications.clear();
  define(window, "innerHeight", { value: viewportHeight, writable: true });
  define(window, "scrollY", { get: () => scrollPosition });
  define(window, "pageYOffset", { get: () => scrollPosition });
  define(document.documentElement, "scrollHeight", { get: () => documentHeight });
  define(document.documentElement, "clientHeight", { get: () => viewportHeight });
  define(document.body, "scrollHeight", { get: () => documentHeight });
  define(window.history, "scrollRestoration", { value: "auto", writable: true });
  scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation((first: number | ScrollToOptions, second?: number) => {
    const top = typeof first === "number" ? second ?? 0 : first.top ?? scrollPosition;
    scrollPosition = Math.max(0, Math.min(top, documentHeight - viewportHeight));
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    nextFrameId += 1;
    frames.set(nextFrameId, callback);
    return nextFrameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  vi.stubGlobal("MutationObserver", TestMutationObserver);
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
});

afterEach(() => {
  cleanup();
  resetRememberedPortalHistory();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [target, properties] of originalDescriptors) {
    for (const [property, descriptor] of properties) {
      if (descriptor) Object.defineProperty(target, property, descriptor);
      else Reflect.deleteProperty(target, property);
    }
  }
  originalDescriptors.clear();
});

describe("shared route scroll restoration", () => {
  it("starts a newly opened page at the top and returns to the parent's exact scroll position", () => {
    mount();
    userScroll(926);
    go("Dining");
    expect(scrollPosition).toBe(0);
    userScroll(280);
    go("Back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent(/^\/areas$/);
    expect(scrollPosition).toBe(926);
  });

  it("keeps separate scroll positions for repeated URLs in history, including Forward", () => {
    mount();
    userScroll(640);
    go("Dining");
    userScroll(180);
    go("Areas");
    expect(scrollPosition).toBe(0);
    userScroll(1_230);
    go("Back");
    expect(scrollPosition).toBe(180);
    go("Back");
    expect(scrollPosition).toBe(640);
    go("Forward");
    expect(scrollPosition).toBe(180);
    go("Forward");
    expect(scrollPosition).toBe(1_230);
  });

  it("preserves position while changing a query filter but restores each query's own POP entry", () => {
    mount("/areas/calendar?date=2026-10-26");
    userScroll(710);
    go("Calendar Tuesday");
    expect(scrollPosition).toBe(710);
    userScroll(320);
    go("Back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("date=2026-10-26");
    expect(scrollPosition).toBe(710);
    go("Forward");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("date=2026-10-27");
    expect(scrollPosition).toBe(320);
  });

  it("restores an explicit REPLACE return by complete URL without borrowing another query's saved position", () => {
    mount("/areas/calendar?date=2026-10-26");
    userScroll(830);
    go("Dining");
    go("Replace Monday");
    expect(scrollPosition).toBe(830);
    go("Dining");
    go("Replace Tuesday");
    expect(scrollPosition).toBe(0);
  });

  it("waits for asynchronously loaded parent content before finishing restoration", () => {
    mount();
    userScroll(1_450);
    go("Dining");
    documentHeight = 1_000;
    go("Back");
    expect(scrollPosition).toBeLessThan(1_450);
    resizeDocument(pageHeight);
    expect(scrollPosition).toBe(1_450);
  });

  it("bounds a pending restoration so late content cannot pull the user after its deadline", () => {
    mount();
    userScroll(1_450);
    go("Dining");
    documentHeight = 1_000;
    go("Back");
    act(() => { vi.advanceTimersByTime(8_100); });
    flushFrames();
    const positionAfterDeadline = scrollPosition;
    resizeDocument(pageHeight);
    expect(scrollPosition).toBe(positionAfterDeadline);
    expect(scrollPosition).not.toBe(1_450);
  });

  it.each(["wheel", "touchstart", "keydown"])("cancels a delayed restore after the person's %s intent", intent => {
    mount();
    userScroll(1_450);
    go("Dining");
    documentHeight = 1_000;
    go("Back");
    if (intent === "keydown") fireEvent.keyDown(window, { key: "ArrowDown" });
    else fireEvent(window, new Event(intent, { bubbles: true }));
    userScroll(95);
    resizeDocument(pageHeight);
    expect(scrollPosition).toBe(95);
  });

  it("cancels a delayed restoration when another page is opened quickly", () => {
    mount();
    userScroll(1_450);
    go("Dining");
    documentHeight = 1_000;
    go("Back");
    go("Resources");
    resizeDocument(pageHeight);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(/^\/areas\/resources$/);
    expect(scrollPosition).toBe(0);
  });

  it.each([
    "person-2:campus-1:live",
    "person-1:campus-2:live",
    "person-1:campus-1:simulation-world-1",
  ])("does not reuse pending or remembered positions across scope %s", nextScope => {
    const application = mount();
    userScroll(1_450);
    go("Dining");
    documentHeight = 1_000;
    go("Back");
    application.changeScope(nextScope);
    resizeDocument(pageHeight);
    expect(scrollPosition).toBe(0);
    go("Dining");
    go("Back");
    expect(scrollPosition).toBe(0);
  });

  it("sets native history restoration to manual only while mounted", () => {
    const application = mount();
    expect(window.history.scrollRestoration).toBe("manual");
    application.unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it("restores correctly after React Strict Mode replays mount effects", () => {
    const application = render(<StrictMode><TestApplication scopeKey="person-1:campus-1:live" initialPath="/areas" /></StrictMode>);
    flushFrames();
    expect(window.history.scrollRestoration).toBe("manual");
    userScroll(940);
    go("Dining");
    go("Back");
    expect(scrollPosition).toBe(940);
    application.unmount();
    expect(window.history.scrollRestoration).toBe("auto");
  });

  it.each([true, false])("does not scroll the old page while its lazy destination is still waiting to commit (transitions: %s)", async useTransitions => {
    let resolveDestination!: (module: { default: ComponentType }) => void;
    const destination = new Promise<{ default: ComponentType }>(resolve => { resolveDestination = resolve; });
    const DiningPage = lazy(() => destination);
    render(<CommitAwareApplication DiningPage={DiningPage} useTransitions={useTransitions} />);
    flushFrames();
    userScroll(930);
    scrollToSpy.mockClear();
    go("Dining");
    if (!useTransitions) expect(screen.getByText("Loading destination")).toBeVisible();
    else expect(screen.getByRole("heading", { name: "Areas content" })).toBeVisible();
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(scrollPosition).toBe(930);

    await act(async () => { resolveDestination({ default: DiningTestPage }); await destination; });
    resizeDocument(pageHeight);
    expect(screen.getByRole("heading", { name: "Dining content" })).toBeVisible();
    expect(scrollPosition).toBe(0);
    go("Back");
    expect(screen.getByRole("heading", { name: "Areas content" })).toBeVisible();
    expect(scrollPosition).toBe(930);
  });

  it("waits for the committed parent to finish loading rather than restoring into its placeholder", () => {
    const application = render(<CommitAwareApplication />);
    flushFrames();
    userScroll(1_110);
    go("Dining");
    userScroll(150);
    application.rerender(<CommitAwareApplication loadingParent />);
    go("Back");
    expect(screen.getByRole("heading", { name: "Areas content" })).toBeVisible();
    expect(scrollPosition).toBe(150);
    application.rerender(<CommitAwareApplication />);
    resizeDocument(pageHeight);
    expect(scrollPosition).toBe(1_110);
  });

  it("starts a query-selected detail at the top, preserves an ordinary detail filter, and restores the list on Back", () => {
    mount("/areas/resources?status=available");
    userScroll(940);
    go("Resource detail");
    expect(scrollPosition).toBe(0);
    userScroll(290);
    go("Resource history");
    expect(scrollPosition).toBe(290);
    userScroll(510);
    go("Another resource");
    expect(scrollPosition).toBe(0);
    go("Back");
    expect(scrollPosition).toBe(510);
    go("Back");
    expect(scrollPosition).toBe(290);
    go("Back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("status=available");
    expect(scrollPosition).toBe(940);
  });

  it.each([
    { selector: "student", parentHref: "/areas/people/records?school=campus-1&context=learning" },
    { selector: "guardian", parentHref: "/areas/people/records?school=campus-1&student=learner-1&student_key=L001&context=learning" },
    { selector: "assessment_id", parentHref: "/areas/assessments/results?result_year=all&result_kind=assessment&result_page=2" },
    { selector: "report_batch_id", parentHref: "/areas/reports/progress?result_year=2026-27&result_search=term" },
  ])("opens a $selector query detail at the top and restores its parent list on POP", ({ selector, parentHref }) => {
    mount(parentHref);
    userScroll(1_160);
    go(`Open ${selector} detail`);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(`${selector}=${selector}-1`);
    expect(scrollPosition).toBe(0);
    userScroll(280);
    go("Back");
    expect(screen.getByLabelText("Current route").textContent).toBe(parentHref);
    expect(scrollPosition).toBe(1_160);
    go("Forward");
    expect(scrollPosition).toBe(280);
  });

  it("restores the parent's position when a custom header Back control navigates with PUSH", () => {
    mount("/areas/resources?status=available");
    userScroll(1_070);
    go("Resource detail");
    userScroll(260);
    go("Back to resource list");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("status=available");
    expect(scrollPosition).toBe(1_070);
    go("Back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("item=resource-1");
    expect(scrollPosition).toBe(260);
  });

  it("restores a resource list through its ordinary query-removing Back button without a shared header marker", () => {
    mount("/areas/resources?status=available");
    userScroll(1_080);
    go("Resource detail");
    userScroll(340);
    go("Resource list back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("status=available");
    expect(scrollPosition).toBe(1_080);
  });

  it("returns from a nested dining issue to the saved session and then its dated list", () => {
    mount("/areas/dining?date=2026-10-26&view=day");
    userScroll(970);
    go("Dining session");
    expect(scrollPosition).toBe(0);
    userScroll(640);
    go("Dining issue");
    expect(scrollPosition).toBe(0);
    userScroll(170);
    go("Dining session back");
    expect(screen.getByLabelText("Current route")).toHaveTextContent("session_id=lunch");
    expect(screen.getByLabelText("Current route")).not.toHaveTextContent("issue_id");
    expect(scrollPosition).toBe(640);
    go("Dining date back");
    expect(screen.getByLabelText("Current route")).not.toHaveTextContent("session_id");
    expect(scrollPosition).toBe(970);
  });

  it("discards a departed account's shared Back history on initial mount and records only the current route", () => {
    vi.spyOn(window.history, "state", "get").mockReturnValue({ idx: 7 });
    rememberPortalLocation(6, "/areas/people?campus=departed-campus");
    expect(previousPortalLocation(7)).toBe("/areas/people?campus=departed-campus");
    const application = mount("/areas/dining");
    expect(previousPortalLocation(7)).toBeNull();
    expect(previousPortalLocation(8)).toBe("/areas/dining");
    application.unmount();
    rememberPortalLocation(6, "/areas/resources?owner=departed-account");
    mount("/work", "person-2:campus-2:simulation-world-2");
    expect(previousPortalLocation(7)).toBeNull();
    expect(previousPortalLocation(8)).toBe("/work");
  });

  it("waits for a decoded hash target, then prefers the saved history position on a later return", () => {
    const scrollIntoView = vi.fn(() => { scrollPosition = 1_760; });
    define(HTMLElement.prototype, "scrollIntoView", { value: scrollIntoView, writable: true });
    mount();
    userScroll(680);
    go("Repair queue anchor");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollPosition).toBe(680);
    render(<section id="repair queue">Repair queue</section>);
    resizeDocument(pageHeight);
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ behavior: "instant" });
    expect(scrollPosition).toBe(1_760);
    userScroll(1_930);
    go("Back");
    expect(scrollPosition).toBe(680);
    go("Forward");
    expect(scrollPosition).toBe(1_930);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
