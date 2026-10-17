import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { getCampusKpis } from "./kpiApi";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

beforeEach(() => apiFetchMock.mockReset());

describe("getCampusKpis", () => {
  it("requests an independently scoped KPI page and range", async () => {
    const signal = new AbortController().signal;
    apiFetchMock.mockResolvedValue({});

    await getCampusKpis("school/one", {
      campusId: "campus-1",
      page: "coordination",
      range: "90d",
    }, signal);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/schools/school%2Fone/campus-view/kpis?page=coordination&range=90d&campus_id=campus-1",
      { signal },
    );
  });
});
