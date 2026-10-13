import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ status: "authenticated", user: { id: "user-1" } }),
}));

function LocationProbe() {
  const location = useLocation();
  const returnTo = (location.state as { portalReturnTo?: unknown } | null)?.portalReturnTo;
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="return-to">{typeof returnTo === "string" ? returnTo : ""}</output></>;
}

afterEach(() => {
  cleanup();
  apiFetchMock.mockReset();
});

describe("NotificationCenter", () => {
  it("opens an agent verification link and clears it when dismissed", async () => {
    apiFetchMock.mockResolvedValue({ results: [], unread_count: 0, next_cursor: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={["/student?notifications=open"]}><NotificationCenter buttonClassName="notification-trigger" /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  });
  it("refreshes notifications whenever the panel opens", async () => {
    apiFetchMock.mockResolvedValue({ results: [], unread_count: 0, next_cursor: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const interact = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NotificationCenter buttonClassName="notification-trigger" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    await interact.click(screen.getByRole("button", { name: "Notifications" }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("dialog", { name: "Notifications" })).toBeVisible();
  });

  it("defers typed attention acknowledgement until the exact destination loads", async () => {
    const notificationId = "20000000-0000-4000-a000-000000000002";
    apiFetchMock.mockResolvedValue({
      results: [{
        id: notificationId,
        kind: "general",
        title: "A result has been published",
        body: "Mathematics",
        link: "/parent/results?student_id=30000000-0000-4000-a000-000000000003&assessment_id=40000000-0000-4000-a000-000000000004",
        // The producer-owned link is the typed target. Stale metadata must not
        // redirect the acknowledgement to a different child.
        metadata: { student_id: "30000000-0000-4000-a000-000000000009" },
        attention_eligible: true,
        read_at: null,
        created_at: "2026-10-13T10:00:00.000Z",
      }],
      unread_count: 1,
      next_cursor: null,
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const interact = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/parent/events?view=past&notifications=open"]}>
          <NotificationCenter buttonClassName="notification-trigger" />
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await interact.click(await screen.findByRole("button", { name: /A result has been published/i }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/parent/results?student_id=30000000-0000-4000-a000-000000000003&assessment_id=40000000-0000-4000-a000-000000000004&attention_notification_id=${notificationId}`);
    expect(screen.getByTestId("return-to")).toHaveTextContent("/parent/events?view=past");
    expect(apiFetchMock).not.toHaveBeenCalledWith(
      `/api/v1/notifications/${notificationId}/read/`,
      expect.anything(),
    );
  });

  it("loads earlier notifications progressively instead of hiding records beyond the first page", async () => {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === "/api/v1/notifications/older-notification/read/") {
        return Promise.resolve({ id: "older-notification", read_at: "2026-10-13T10:10:00.000Z" });
      }
      return Promise.resolve(path.includes("cursor=older-cursor") ? {
      results: [{
        id: "older-notification",
        kind: "general",
        title: "Earlier timetable update",
        body: "A period changed last week.",
        link: "/parent/timetable?date=2026-10-06",
        attention_eligible: false,
        read_at: null,
        created_at: "2026-10-06T10:00:00.000Z",
      }],
      unread_count: 2,
      next_cursor: null,
    } : {
      results: [{
        id: "latest-notification",
        kind: "general",
        title: "Latest school update",
        body: "A current update.",
        link: "/parent/notices/latest",
        attention_eligible: false,
        read_at: null,
        created_at: "2026-10-13T10:00:00.000Z",
      }],
      unread_count: 2,
      next_cursor: "older-cursor",
      });
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const interact = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/parent?notifications=open"]}>
          <NotificationCenter buttonClassName="notification-trigger" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: /Latest school update/i })).toBeVisible();
    await interact.click(screen.getByRole("button", { name: "Earlier updates" }));

    expect(await screen.findByRole("button", { name: /Earlier timetable update/i })).toBeVisible();
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/notifications/?limit=50&cursor=older-cursor");
    expect(screen.queryByRole("button", { name: "Earlier updates" })).not.toBeInTheDocument();
    await interact.click(screen.getByRole("button", { name: /Earlier timetable update/i }));
    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeVisible();
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/notifications/older-notification/read/", { method: "POST" });
  });
});
