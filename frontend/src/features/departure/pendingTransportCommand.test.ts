import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import {
  clearPendingTransportCommandsForTests,
  executePendingTransportCommand,
  type TransportCommandScope,
} from "./pendingTransportCommand";

const scope: TransportCommandScope = {
  schoolId: "school-1",
  actorId: "staff-1",
  operation: "respond",
  targetId: "swap-1",
};

afterEach(() => clearPendingTransportCommandsForTests());

describe("pending transport commands", () => {
  it("reuses the command identity after an ambiguous response, including across a remount", async () => {
    const sent: string[] = [];
    const material = { decision: "accepted", expected_revision: 1, note: "  I can cover  " };

    await expect(executePendingTransportCommand(scope, material, (commandId) => {
      sent.push(commandId);
      return Promise.reject(new TypeError("connection lost after send"));
    })).rejects.toThrow("connection lost");

    await executePendingTransportCommand(scope, { note: "I can cover", expected_revision: 1, decision: "accepted" }, (commandId) => {
      sent.push(commandId);
      return Promise.resolve({ status: "accepted" });
    });

    expect(sent[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(sent[1]).toBe(sent[0]);
  });

  it("does not reuse identities across actors, operations, targets or changed material", async () => {
    const identities: string[] = [];
    const retain = async (nextScope: TransportCommandScope, material: unknown) => {
      await expect(executePendingTransportCommand(nextScope, material, (commandId) => {
        identities.push(commandId);
        return Promise.reject(new TypeError("uncertain"));
      })).rejects.toThrow("uncertain");
    };

    await retain(scope, { decision: "accepted", expected_revision: 1 });
    await retain({ ...scope, actorId: "staff-2" }, { decision: "accepted", expected_revision: 1 });
    await retain({ ...scope, operation: "decide" }, { decision: "approved", expected_revision: 2 });
    await retain({ ...scope, targetId: "swap-2" }, { decision: "accepted", expected_revision: 1 });
    await retain(scope, { decision: "rejected", expected_revision: 1 });

    expect(new Set(identities).size).toBe(identities.length);
  });

  it("clears a completed or definitively rejected command but retains retryable failures", async () => {
    const action = vi.fn<(commandId: string) => Promise<unknown>>();
    action.mockRejectedValueOnce(new ApiError("busy", 503));
    action.mockRejectedValueOnce(new ApiError("invalid", 400));
    action.mockResolvedValueOnce({ status: "accepted" });

    const material = { decision: "accepted", expected_revision: 1 };
    await expect(executePendingTransportCommand(scope, material, action)).rejects.toThrow("busy");
    await expect(executePendingTransportCommand(scope, material, action)).rejects.toThrow("invalid");
    await executePendingTransportCommand(scope, material, action);

    expect(action.mock.calls[1]?.[0]).toBe(action.mock.calls[0]?.[0]);
    expect(action.mock.calls[2]?.[0]).not.toBe(action.mock.calls[1]?.[0]);
  });
});
