import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CampusLabControl from "./CampusLabControl";
import { setCampusLabEnabled } from "./api";
import { useOptionalCampusLabProjection } from "./CampusLabProjectionContext";

vi.mock("./api", () => ({ setCampusLabEnabled: vi.fn() }));
vi.mock("./CampusLabProjectionContext", () => ({ useOptionalCampusLabProjection: vi.fn() }));

describe("CampusLabControl", () => {
  const refetch = vi.fn(() => Promise.resolve(undefined));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(setCampusLabEnabled).mockResolvedValue({} as never);
  });

  it("stops an active Cambridge simulation through the explicit control", async () => {
    vi.mocked(useOptionalCampusLabProjection).mockReturnValue({
      status: { control: { enabled: true, changed_at: "2026-10-17T10:00:00Z", changed_by: "startup" } } as never,
      isPending: false,
      isError: false,
      refetch,
    });
    render(<CampusLabControl />);
    fireEvent.click(screen.getByRole("button", { name: "Stop simulation" }));
    await waitFor(() => expect(setCampusLabEnabled).toHaveBeenCalledWith(false));
    expect(refetch).toHaveBeenCalled();
  });

  it("activates a stopped Cambridge simulation", async () => {
    vi.mocked(useOptionalCampusLabProjection).mockReturnValue({
      status: { control: { enabled: false, changed_at: "2026-10-17T10:00:00Z", changed_by: "administrator" } } as never,
      isPending: false,
      isError: false,
      refetch,
    });
    render(<CampusLabControl />);
    fireEvent.click(screen.getByRole("button", { name: "Activate simulation" }));
    await waitFor(() => expect(setCampusLabEnabled).toHaveBeenCalledWith(true));
  });
});
