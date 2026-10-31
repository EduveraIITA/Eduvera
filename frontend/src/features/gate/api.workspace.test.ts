import { beforeEach, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { getGateWorkspace } from "./api";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());

it("keeps the default workspace URL compatible", async () => {
  await getGateWorkspace("school");
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/gate/schools/school/workspace/", { signal: undefined });
});

it("transports the finite page, server filter and exact linked visitor without changing commands", async () => {
  const signal = new AbortController().signal;
  await getGateWorkspace("school", { visitorPage: 2, visitorFilter: "inside", visitorId: "visitor-123", signal });
  expect(apiFetch).toHaveBeenCalledWith("/api/v1/gate/schools/school/workspace/?visitor_page=2&visitor_filter=inside&visitor_id=visitor-123", { signal });
});
