import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationCenter } from "./NotificationCenter";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));
vi.mock("../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ status: "authenticated", user: { id: "user-1" } }),
}));

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
});
