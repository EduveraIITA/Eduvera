import { describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";

describe("SchoolEventService broker scheduling", () => {
  it("closes live streams before HTTP shutdown so a managed server can restart", async () => {
    const events = new SchoolEventService({} as DatabaseService);
    const end = vi.fn();
    const broker = { removeAllListeners: vi.fn(), end: vi.fn(() => Promise.resolve()) };
    (events as any).broker = broker;
    (events as any).brokerReady = true;
    (events as any).clients.set("open-stream", { id: "open-stream", closed: false, reply: { raw: { writableEnded: false, end } } });

    await events.beforeApplicationShutdown();

    expect(end).toHaveBeenCalledTimes(1);
    expect((events as any).clients.size).toBe(0);
    expect(events.isReady()).toBe(false);
    expect(broker.end).toHaveBeenCalledTimes(1);
    expect((events as any).shuttingDown).toBe(true);
  });
  it("coalesces a burst of broker notifications into bounded ordered drains", async () => {
    const events = new SchoolEventService({} as DatabaseService);
    let drainCalls = 0;
    let releaseFirst!: () => void;
    const firstDrain = new Promise<void>((resolve) => { releaseFirst = resolve; });
    (events as any).brokerReady = true;
    (events as any).drainPublishedEvents = () => {
      drainCalls += 1;
      return drainCalls === 1 ? firstDrain : Promise.resolve();
    };

    (events as any).receiveBrokerNotification(JSON.stringify({ id: "event-0" }));
    await Promise.resolve();
    expect(drainCalls).toBe(1);

    for (let index = 1; index < 100; index++) {
      (events as any).receiveBrokerNotification(JSON.stringify({ id: `event-${index}` }));
    }

    const work = (events as any).brokerDrainPromise as Promise<void>;
    releaseFirst();
    await work;

    // One active pass plus one coalesced pass for every wake received while
    // that first database read was in flight, never one query per NOTIFY.
    expect(drainCalls).toBe(2);
  });

  it("retires the failed active broker and schedules reconnect without stale end races", () => {
    const events = new SchoolEventService({} as DatabaseService);
    const activeBroker = { removeAllListeners: vi.fn(), end: vi.fn(() => Promise.resolve()) };
    const replacementBroker = { removeAllListeners: vi.fn() };
    const scheduleReconnect = vi.fn();
    (events as any).logger.error = vi.fn();
    (events as any).scheduleReconnect = scheduleReconnect;
    (events as any).broker = activeBroker;
    (events as any).brokerReady = true;

    (events as any).handleBrokerDisconnect(activeBroker, new Error("connection lost"));

    expect(activeBroker.removeAllListeners).toHaveBeenCalledWith("notification");
    expect(activeBroker.end).toHaveBeenCalledTimes(1);
    expect((events as any).broker).toBeUndefined();
    expect((events as any).brokerReady).toBe(false);
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);

    (events as any).broker = replacementBroker;
    (events as any).brokerReady = true;
    (events as any).handleBrokerDisconnect(activeBroker);
    expect((events as any).broker).toBe(replacementBroker);
    expect((events as any).brokerReady).toBe(true);
    expect(scheduleReconnect).toHaveBeenCalledTimes(1);
  });
});
