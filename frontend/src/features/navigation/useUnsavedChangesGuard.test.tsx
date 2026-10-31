import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserRouter, Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";
import { PortalPageTitle } from "./PortalPageTitle";
import { rememberPortalLocation, resetRememberedPortalHistory } from "./portalHistory";

const browserOrigin = "/teacher/attendance";
const browserEditor = "/teacher/attendance/class-1";
function BrowserGuardPage({ onUnmount }: { onUnmount: () => void }) {
  const [draft, setDraft] = useState("Retained attendance note");
  const guard = useUnsavedChangesGuard(true, "Leave this draft?");
  useEffect(() => () => onUnmount(), [onUnmount]);
  return <><PortalPageTitle title="Attendance" rootPath="/today" backTo={browserOrigin} beforeBack={guard} /><label>Draft note<input value={draft} onChange={(event) => setDraft(event.target.value)} /></label></>;
}
function renderBrowserEditor() {
  window.history.replaceState({ idx: 0, key: "origin" }, "", browserOrigin);
  window.history.pushState({ idx: 1, key: "editor" }, "", browserEditor);
  rememberPortalLocation(0, browserOrigin);
  const onUnmount = vi.fn();
  render(<BrowserRouter><Routes><Route path={browserOrigin} element={<h1>Attendance queue</h1>} /><Route path={browserEditor} element={<BrowserGuardPage onUnmount={onUnmount} />} /></Routes></BrowserRouter>);
  return onUnmount;
}

function GuardHarness({ dirty = true }: { dirty?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const confirmNavigation = useUnsavedChangesGuard(dirty, "Leave this work?");

  return (
    <>
      <output aria-label="Current location">{location.pathname}</output>
      <Link to="/next">Direct link</Link>
      <button
        type="button"
        onClick={() => {
          if (confirmNavigation()) void navigate("/next");
        }}
      >
        Guarded control
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetRememberedPortalHistory();
  window.history.replaceState({}, "", "/");
});

describe("useUnsavedChangesGuard", () => {
  it("blocks a router link when the user keeps the draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/current"]}>
        <GuardHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("link", { name: "Direct link" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent("/current");
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("does not ask twice when a control confirms before navigating", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/current"]}>
        <GuardHarness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Guarded control" }));

    expect(screen.getByLabelText("Current location")).toHaveTextContent("/next");
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("registers a browser-unload warning only while work is dirty", () => {
    const view = render(
      <MemoryRouter>
        <GuardHarness />
      </MemoryRouter>,
    );
    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);

    view.rerender(
      <MemoryRouter>
        <GuardHarness dirty={false} />
      </MemoryRouter>,
    );
    const cleanUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanUnload);
    expect(cleanUnload.defaultPrevented).toBe(false);
  });

  it("cancels shell Back in capture phase without unmounting or changing the visible draft", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onUnmount = renderBrowserEditor();
    await userEvent.type(screen.getByLabelText("Draft note"), " with an unsaved edit");
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(window.location.pathname).toBe(browserEditor));
    expect(screen.getByLabelText("Draft note")).toHaveValue("Retained attendance note with an unsaved edit");
    expect(screen.queryByRole("heading", { name: "Attendance queue" })).not.toBeInTheDocument();
    expect(onUnmount).not.toHaveBeenCalled();
  });

  it("accepts shell Back with one prompt at the exact observed POP transition", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onUnmount = renderBrowserEditor();
    await userEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(await screen.findByRole("heading", { name: "Attendance queue" })).toBeVisible();
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Leave this draft?");
    expect(onUnmount).toHaveBeenCalledOnce();
  });

  it("keeps ordinary browser Back guarded and restores the same visible editor on cancel", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onUnmount = renderBrowserEditor();
    act(() => { window.history.back(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    await waitFor(() => expect(window.location.pathname).toBe(browserEditor));
    expect(screen.getByLabelText("Draft note")).toHaveValue("Retained attendance note");
    expect(onUnmount).not.toHaveBeenCalled();
  });

  it("leaves no authorization after a no-op shell Back, even after time passes", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onUnmount = renderBrowserEditor();
    const go = vi.spyOn(window.history, "go").mockImplementation(() => undefined);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    act(() => { vi.advanceTimersByTime(60_000); });
    vi.useRealTimers();
    expect(go).toHaveBeenCalledExactlyOnceWith(-1);
    expect(confirm).not.toHaveBeenCalled();
    expect(onUnmount).not.toHaveBeenCalled();
    go.mockRestore();
    act(() => { window.history.back(); });
    await waitFor(() => expect(confirm).toHaveBeenCalledExactlyOnceWith("Leave this draft?"));
    await waitFor(() => expect(window.location.pathname).toBe(browserEditor));
    expect(screen.getByLabelText("Draft note")).toHaveValue("Retained attendance note");
    expect(onUnmount).not.toHaveBeenCalled();
  });
});
