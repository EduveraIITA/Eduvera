import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../lib/api";
import {
  clearPendingStaffLeaveCommand,
  clearPendingStaffLeaveCommandsForTests,
  isDefinitiveStaffLeaveFailure,
  pendingStaffLeaveCommand,
  staffLeaveMaterialHash,
  type StaffLeaveCommandScope,
} from "./pendingLeaveCommand";

const scope: StaffLeaveCommandScope = {
  schoolId: "school-1",
  actorId: "actor-1",
  operation: "decide",
  targetId: "request-1",
};

afterEach(() => clearPendingStaffLeaveCommandsForTests());

describe("pending staff leave commands", () => {
  it("normalizes material and reuses the command after an uncertain response", async () => {
    const first = await pendingStaffLeaveCommand(scope, {
      expected_revision: 3,
      decision: "approved",
      note: "  Cover arranged  ",
    });
    const retry = await pendingStaffLeaveCommand(scope, {
      note: "Cover arranged",
      decision: "approved",
      expected_revision: 3,
    });

    expect(retry).toEqual(first);
    expect(first.materialHash).toHaveLength(64);
  });

  it("does not collide across operations, requests, actors, or changed material", async () => {
    const first = await pendingStaffLeaveCommand(scope, { expected_revision: 3, decision: "approved", note: "" });
    const changed = await pendingStaffLeaveCommand(scope, { expected_revision: 3, decision: "rejected", note: "Not covered" });
    const otherRequest = await pendingStaffLeaveCommand({ ...scope, targetId: "request-2" }, { expected_revision: 3, decision: "approved", note: "" });
    const otherOperation = await pendingStaffLeaveCommand({ ...scope, operation: "withdraw" }, { expected_revision: 3 });
    const otherActor = await pendingStaffLeaveCommand({ ...scope, actorId: "actor-2" }, { expected_revision: 3, decision: "approved", note: "" });

    expect(new Set([first.commandId, changed.commandId, otherRequest.commandId, otherOperation.commandId, otherActor.commandId]).size).toBe(5);
  });

  it("clears only the exact retained command after a definitive outcome", async () => {
    const pending = await pendingStaffLeaveCommand(scope, { expected_revision: 3, decision: "approved", note: "" });
    clearPendingStaffLeaveCommand(scope, { ...pending, commandId: crypto.randomUUID() });
    expect(await pendingStaffLeaveCommand(scope, { expected_revision: 3, decision: "approved", note: "" })).toEqual(pending);

    clearPendingStaffLeaveCommand(scope, pending);
    const next = await pendingStaffLeaveCommand(scope, { expected_revision: 3, decision: "approved", note: "" });
    expect(next.commandId).not.toBe(pending.commandId);
  });

  it("retains retryable and ambiguous failures but identifies definitive client responses", () => {
    expect(isDefinitiveStaffLeaveFailure(new TypeError("network failed"))).toBe(false);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("interrupted", 200))).toBe(false);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("timeout", 408))).toBe(false);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("rate limited", 429))).toBe(false);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("unavailable", 503))).toBe(false);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("invalid", 400))).toBe(true);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("forbidden", 403))).toBe(true);
    expect(isDefinitiveStaffLeaveFailure(new ApiError("conflict", 409))).toBe(true);
  });

  it("hashes canonical material without storing the material itself", async () => {
    const hash = await staffLeaveMaterialHash({ reason: "Private appointment", dates: ["2026-10-18"] });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("Private");
  });
});
