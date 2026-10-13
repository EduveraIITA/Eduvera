import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAttention } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("getAttention", () => {
  it("keeps parent attention scoped to the selected child", async () => {
    apiFetchMock.mockResolvedValue({});
    await getAttention("parent", "10000000-0000-4000-a000-000000000002");
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/attention?portal=parent&student_id=10000000-0000-4000-a000-000000000002",
    );
  });

  it("uses school scope for staff portals", async () => {
    apiFetchMock.mockResolvedValue({});
    await getAttention("principal");
    expect(apiFetchMock).toHaveBeenCalledWith("/api/v1/attention?portal=principal");
  });
});
