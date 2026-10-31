import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { getMemberInvitation, invitePersonToApp } from "../onboarding/api";
vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
beforeEach(() => { vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockResolvedValue({}); });
describe("exact person app-access API", () => {
  it("sends one explicit neutral membership and stable invitation command, with no implied work or enrollment", async () => {
    const input = { email: "aarav@example.com", role: "member" as const, person_id: "person", idempotency_key: "retry-key" };
    await invitePersonToApp("campus/id", input);
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/schools/campus%2Fid/invitations/", { method: "POST", body: JSON.stringify(input) });
  });
  it("loads only the requested authorized invitation, never the truncated institution list", async () => {
    await getMemberInvitation("campus/id", "invitation/id");
    expect(apiFetch).toHaveBeenCalledWith("/api/v1/schools/campus%2Fid/invitations/invitation%2Fid/");
  });
});
