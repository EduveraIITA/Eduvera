import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { FastifyReply } from "fastify";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

process.env.DATABASE_URL ??= "postgresql://localhost/thatcampus_stream_lifecycle_unit";

const institutionId = "school-stream-lifecycle";
const instant = "2026-10-19T08:30:00.000Z";
const environment = createLiveExecutionEnvironment({
  institution_id: institutionId,
  clock: {
    now: () => new Date(instant),
    nowIso: () => instant,
  },
});
const user: AuthUser = {
  id: "user-stream-owner",
  username: "stream-owner",
  email: "stream-owner@example.test",
  first_name: "Stream",
  last_name: "Owner",
  role: "admin",
  is_active: true,
  active_school_id: institutionId,
};

class RequestRawMock extends EventEmitter {}

class ReplyRawMock extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  readonly frames: string[] = [];
  readonly writeHead = vi.fn();
  readonly end = vi.fn(() => {
    this.writableEnded = true;
  });
  readonly destroy = vi.fn(() => {
    this.destroyed = true;
  });

  write(frame: string) {
    this.frames.push(frame);
    return true;
  }
}

function request(sessionHash: string) {
  return {
    executionEnvironment: environment,
    sessionHash,
    headers: {},
    raw: new RequestRawMock(),
  } as unknown as AuthenticatedRequest;
}

function reply() {
  const raw = new ReplyRawMock();
  return {
    raw,
    value: {
      hijack: vi.fn(),
      raw,
    } as unknown as FastifyReply,
  };
}

function service() {
  const events = new SchoolEventService({} as DatabaseService);
  (events as unknown as { brokerReady: boolean }).brokerReady = true;
  (events as unknown as { requestFullSync: ReturnType<typeof vi.fn> }).requestFullSync = vi
    .fn()
    .mockImplementation((client: { lastSequence: number | null }) => {
      client.lastSequence = 0;
      return Promise.resolve();
    });
  return events;
}

function connectedClientCount(events: SchoolEventService) {
  return (events as unknown as { clients: Map<string, unknown> }).clients.size;
}

describe("school event stream lifecycle", () => {
  it("replaces an overlapping connection from only the same authenticated session", async () => {
    const events = service();
    const first = reply();
    const second = reply();

    await events.openStream(user, first.value, request("session-a"));
    await events.openStream(user, second.value, request("session-a"));

    expect(first.raw.frames.join("")).toContain("event: stream.replaced");
    expect(first.raw.end).toHaveBeenCalledOnce();
    expect(second.raw.end).not.toHaveBeenCalled();
    expect(connectedClientCount(events)).toBe(1);
  });

  it("never evicts a connection owned by a different session", async () => {
    const events = service();
    const first = reply();
    const second = reply();

    await events.openStream(user, first.value, request("session-a"));
    await events.openStream(user, second.value, request("session-b"));

    expect(first.raw.frames.join("")).not.toContain("event: stream.replaced");
    expect(first.raw.end).not.toHaveBeenCalled();
    expect(second.raw.end).not.toHaveBeenCalled();
    expect(connectedClientCount(events)).toBe(2);
  });

  it("removes a client as soon as the outgoing response closes", async () => {
    const events = service();
    const connection = reply();

    await events.openStream(user, connection.value, request("session-a"));
    expect(connectedClientCount(events)).toBe(1);

    connection.raw.emit("close");

    expect(connectedClientCount(events)).toBe(0);
    expect(connection.raw.end).toHaveBeenCalledOnce();
  });
});
