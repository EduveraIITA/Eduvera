import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { getActivityOccurrences, getActivityPlans } from "./api";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
afterEach(() => vi.clearAllMocks());

describe("activity calendar requests", () => {
  it("requests expected occurrences before server pagination while keeping planning history separate", async () => {
    await getActivityOccurrences("campus id", "2026-10-20", "2026-10-26", 2);
    const url = new URL(vi.mocked(apiFetch).mock.calls[0]![0], "https://campus.example");
    expect(url.pathname).toBe("/api/v1/schools/campus%20id/activities/occurrences");
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: "2026-10-20", until: "2026-10-26", page: "2", page_size: "25", state: "expected" });
    await getActivityPlans("campus id", "2026-10-20", "2026-10-26");
    const history = new URL(vi.mocked(apiFetch).mock.calls[1]![0], "https://campus.example");
    expect(history.pathname).toBe("/api/v1/schools/campus%20id/activities/plans");
    expect(history.searchParams.has("state")).toBe(false);
  });
});
