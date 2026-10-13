import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Link, MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { useUnsavedChangesGuard } from "./useUnsavedChangesGuard";

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
  vi.restoreAllMocks();
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
});
