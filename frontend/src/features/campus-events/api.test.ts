import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import { cancelCampusEvent, recordCampusEventConsent, respondToCampusEvent } from "./api";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));

const apiFetchMock = vi.mocked(apiFetch);

function requestBody(callIndex: number): Record<string, unknown> {
  const body = apiFetchMock.mock.calls[callIndex]?.[1]?.body;
  if (typeof body !== "string") throw new Error(`Expected request ${callIndex + 1} to contain a JSON string body.`);
  return JSON.parse(body) as Record<string, unknown>;
}

beforeEach(() => apiFetchMock.mockReset());

describe("campus event command contracts", () => {
  it("sends the participant RSVP and consent revisions for optimistic concurrency", async () => {
    apiFetchMock.mockResolvedValue({});

    await respondToCampusEvent("school-1", "event-1", "student-1", "accepted", 4);
    await recordCampusEventConsent("school-1", "event-1", "student-1", "granted", "", 7);

    expect(requestBody(0)).toMatchObject({ expected_revision: 4, status: "accepted" });
    expect(requestBody(1)).toMatchObject({ expected_revision: 7, status: "granted" });
  });

  it("keeps the internal cancellation reason separate from the family notice", async () => {
    apiFetchMock.mockResolvedValue({});

    await cancelCampusEvent("school-1", "event-1", 3, "Vendor contract breach", "The trip is cancelled because transport is unavailable.");

    expect(requestBody(0)).toMatchObject({
      expected_revision: 3,
      internal_reason: "Vendor contract breach",
      audience_notice: "The trip is cancelled because transport is unavailable.",
    });
  });
});
