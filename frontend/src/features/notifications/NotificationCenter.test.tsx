import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
