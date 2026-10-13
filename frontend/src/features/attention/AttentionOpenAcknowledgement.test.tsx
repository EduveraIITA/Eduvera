import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionOpenAcknowledgement } from "./AttentionOpenAcknowledgement";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ status: "authenticated", user: { id: "10000000-0000-4000-a000-000000000001" } }),
}));

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnTo = (location.state as { portalReturnTo?: unknown } | null)?.portalReturnTo;
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="return-to">{typeof returnTo === "string" ? returnTo : ""}</output><button type="button" onClick={() => navigate("/parent/more")}>Leave screen</button></>;
}

function setup(withReturnState = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[withReturnState ? {
        pathname: "/parent/results",
        search: "?student_id=child-1&attention_notification_id=20000000-0000-4000-a000-000000000002",
        state: { portalReturnTo: "/parent/results?student_id=child-1&period=term" },
      } : "/parent/results?student_id=child-1&attention_notification_id=20000000-0000-4000-a000-000000000002"]}>
        <AttentionOpenAcknowledgement />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { invalidate };
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("AttentionOpenAcknowledgement", () => {
  it("acknowledges after the owning view renders, clears only the stable id and refreshes attention", async () => {
    apiFetchMock.mockResolvedValue({ id: "20000000-0000-4000-a000-000000000002", read_at: "2026-10-13T10:00:00.000Z" });
    const { invalidate } = setup();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/notifications/20000000-0000-4000-a000-000000000002/read/",
      {
        method: "POST",
        body: JSON.stringify({
          opened_target: "/parent/results?student_id=child-1&attention_notification_id=20000000-0000-4000-a000-000000000002",
        }),
      },
    ));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/results?student_id=child-1"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["attention"] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications", "10000000-0000-4000-a000-000000000001"] });
  });

  it("preserves same-portal return provenance while removing the acknowledgement id", async () => {
    apiFetchMock.mockResolvedValue({ id: "20000000-0000-4000-a000-000000000002", read_at: "2026-10-13T10:00:00.000Z" });
    setup(true);

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/results?student_id=child-1"));
    expect(screen.getByTestId("return-to")).toHaveTextContent("/parent/results?student_id=child-1&period=term");
  });

  it("keeps the attention id and cached signal when acknowledgement fails", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const { invalidate } = setup();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("location")).toHaveTextContent("attention_notification_id=20000000-0000-4000-a000-000000000002");
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("does not navigate back to a stale target when acknowledgement finishes after the user leaves", async () => {
    let resolveRequest: ((value: { id: string; read_at: string }) => void) | undefined;
    apiFetchMock.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve; }));
    setup();

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Leave screen" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/more"));
    await act(() => {
      resolveRequest?.({ id: "20000000-0000-4000-a000-000000000002", read_at: "2026-10-13T10:00:00.000Z" });
      return Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/parent/more"));
  });
});
