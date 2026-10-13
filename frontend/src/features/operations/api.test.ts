import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAttendanceContinuityWorkspace, saveAttendanceContinuityBatch } from "./api";

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => apiFetchMock.mockReset());

describe("attendance continuity API", () => {
  it("preserves every signed roster snapshot field when submitting a register", async () => {
    apiFetchMock.mockResolvedValue({});
    const expectedBody = {
      class_section_id: "class-6a",
      date: "2026-10-13",
      records: [{ student_id: "student-1", status: "present", remarks: "" }],
      expected_revision: 0,
      source: "live_app",
      source_reference: "",
      device_id: null,
      observed_at: "2026-10-13T05:00:00.000Z",
      roster_fingerprint: "a".repeat(64),
      roster_captured_at: "2026-10-13T04:58:00.000Z",
      roster_expires_at: "2026-10-14T04:58:00.000Z",
      snapshot_token: "b".repeat(43),
    };

    await saveAttendanceContinuityBatch("class-6a", "2026-10-13", {
      records: expectedBody.records,
      expected_revision: 0,
      idempotency_key: "attendance-command-1",
      source: "live_app",
      device_id: null,
      observed_at: "2026-10-13T05:00:00.000Z",
      roster_fingerprint: "a".repeat(64),
      roster_captured_at: "2026-10-13T04:58:00.000Z",
      roster_expires_at: "2026-10-14T04:58:00.000Z",
      snapshot_token: "b".repeat(43),
    });

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/attendance-continuity/batches/",
      expect.objectContaining({
        method: "POST",
        headers: { "Idempotency-Key": "attendance-command-1" },
        body: JSON.stringify(expectedBody),
      }),
    );
  });

  it("asks the server to pin the exact reconciliation case selected from attention", async () => {
    apiFetchMock.mockResolvedValue({});

    await getAttendanceContinuityWorkspace("2026-10-13", "case-51");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/api/v1/screens/principal/attendance/continuity/?date=2026-10-13&case_id=case-51",
    );
  });
});
