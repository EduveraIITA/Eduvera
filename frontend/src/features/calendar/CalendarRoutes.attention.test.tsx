import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSchoolCalendarDays } from "../school/api";
import { CalendarAttentionGate, calendarAttentionResolution, useRoleCalendarDays } from "./CalendarRoutes";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ memberships: [{ role: "admin", school_id: "school-1" }] }),
}));
vi.mock("../school/api", async (original) => ({
  ...(await original<typeof import("../school/api")>()),
  getSchoolCalendarDays: vi.fn(),
}));
vi.mock("../attention/AttentionOpenAcknowledgement", () => ({
  AttentionOpenAcknowledgement: () => <output data-testid="calendar-attention-ack" />,
}));

beforeEach(() => vi.clearAllMocks());

describe("authoritative calendar attention loading", () => {
  it("keeps a failed calendar read in an error state instead of substituting demo data", async () => {
    vi.mocked(getSchoolCalendarDays).mockRejectedValue(new Error("Calendar unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRoleCalendarDays("admin", 2026, 9), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("accepts only the exact created calendar record and revision", () => {
    const days = [{
      id: "change-1",
      date: "2026-10-14",
      is_instructional: false,
      label: "Local closure",
      revision: 3,
    }];
    const target = {
      selected: "2026-10-14",
      notificationId: "notification-1",
      changeId: "change-1",
      changeKind: "created" as const,
      changeRevision: 4,
      recordRevision: 3,
    };

    expect(calendarAttentionResolution(days, target)).toBe("exact");
    expect(calendarAttentionResolution(days, { ...target, recordRevision: 2 })).toBe("stale");
    expect(calendarAttentionResolution(days, { ...target, changeId: "another-change" })).toBe("stale");
    expect(calendarAttentionResolution(days, { ...target, selected: "2026-10-15" })).toBe("stale");
  });

  it("acknowledges a removal only after the exact date has no replacement override", () => {
    const target = {
      selected: "2026-10-14",
      notificationId: "notification-1",
      changeId: "removed-change",
      changeKind: "removed" as const,
      changeRevision: 5,
      recordRevision: 2,
    };

    expect(calendarAttentionResolution([], target)).toBe("exact");
    expect(calendarAttentionResolution([{
      id: "replacement-change",
      date: "2026-10-14",
      is_instructional: false,
      label: "Replacement closure",
      revision: 1,
    }], target)).toBe("stale");
    expect(calendarAttentionResolution([], { ...target, changeRevision: undefined })).toBe("stale");
  });

  it("mounts acknowledgement only for an exact loaded target and shows stale state otherwise", () => {
    const day = {
      id: "change-1",
      date: "2026-10-14",
      is_instructional: false,
      label: "Local closure",
      revision: 3,
    };
    const target = {
      selected: day.date,
      notificationId: "notification-1",
      changeId: day.id,
      changeKind: "created" as const,
      changeRevision: 4,
      recordRevision: day.revision,
    };
    const view = render(<CalendarAttentionGate target={target} days={[day]} loaded />);

    expect(screen.getByTestId("calendar-attention-ack")).toBeInTheDocument();
    view.rerender(<CalendarAttentionGate target={{ ...target, recordRevision: 2 }} days={[day]} loaded />);
    expect(screen.queryByTestId("calendar-attention-ack")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("not marked as opened");
  });
});
