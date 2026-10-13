import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { ParentLeavePage } from "./ParentLeavePage";
import { fallbackLeaveData } from "./parentDemoData";
import { TestQueryProvider } from "../../test/TestQueryProvider";

afterEach(cleanup);

function HistoryProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="location">{location.pathname}{location.search}</output><button type="button" onClick={() => navigate(-1)}>Browser back</button></>;
}

describe("ParentLeavePage", () => {
  it("requires consent and exposes an accessible pending-to-authorized flow", async () => {
    const user = userEvent.setup();
    let finishAuthorization!: () => void;
    const onAuthorize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishAuthorization = resolve;
        }),
    );

    render(
      <TestQueryProvider><MemoryRouter>
        <ParentLeavePage onAuthorize={onAuthorize} />
      </MemoryRouter></TestQueryProvider>,
    );

    const consent = screen.getByRole("checkbox", { name: /I authorize Aarav Sharma's absence/i });
    const authorize = screen.getByRole("button", { name: /Authorize & Forward to School/i });

    expect(consent).toBeChecked();
    await user.click(consent);
    expect(authorize).toBeDisabled();

    await user.click(consent);
    await user.click(authorize);

    expect(onAuthorize).toHaveBeenCalledWith(
      "REQ-2026-884",
      expect.stringContaining("Doctor prescribed Aarav complete bed rest"),
    );
    expect(authorize).toBeDisabled();
    expect(authorize).toHaveAccessibleName(/Transmitting Authorization/i);

    await act(async () => {
      finishAuthorization();
      await Promise.resolve();
    });

    expect(await screen.findByText("Authorization submitted")).toBeVisible();
    expect(screen.getByText(/Successfully forwarded to the school attendance team/i)).toBeVisible();
  });

  it("shows an honest empty state when no leave is waiting for sign-off", () => {
    render(
      <TestQueryProvider><MemoryRouter>
        <ParentLeavePage data={{ ...fallbackLeaveData, request: undefined, canAuthorize: false }} />
      </MemoryRouter></TestQueryProvider>,
    );

    expect(screen.getByRole("heading", { name: "No sign-off waiting" })).toBeVisible();
    expect(screen.queryByText("REQ-2026-884")).not.toBeInTheDocument();
  });

  it("replaces leave-tab view state so browser Back leaves the screen", async () => {
    const user = userEvent.setup();
    render(
      <TestQueryProvider><MemoryRouter initialEntries={["/sentinel", "/parent/leave"]} initialIndex={1}>
        <ParentLeavePage />
        <HistoryProbe />
      </MemoryRouter></TestQueryProvider>,
    );

    await user.click(screen.getByRole("tab", { name: /History/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/parent/leave?tab=history");
    await user.click(screen.getByRole("button", { name: "Browser back" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/sentinel");
  });
});
