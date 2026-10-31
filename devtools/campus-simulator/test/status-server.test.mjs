import assert from "node:assert/strict";
import test from "node:test";
import { startStatusServer } from "../src/status-server.mjs";

const proxyKey = "status-test-key-123456789012345";

test("serves status and explicit control only to the local proxy key", async (context) => {
  const snapshot = {
    status: "running",
    generated_at: "2026-10-16T10:00:00.000Z",
    started_at: "2026-10-16T09:59:00.000Z",
    school: { id: "school-1", name: "Cambridge", code: "cis" },
    phase: { id: "lesson", label: "Lesson", description: "Expected", next_change_at: "2026-10-16T10:01:00.000Z" },
    summary: { actors: 1, students: 0, staff: 1, zones: 1 },
    zones: [],
    activity: [],
  };
  let controlState = { enabled: true, clock_mode: "60m", duration_seconds: 3_600 };
  const server = await startStatusServer({
    port: 0,
    proxyKey,
    getStatus: () => snapshot,
    setControl: async (next) => {
      controlState = { ...controlState, ...next };
      return { ...snapshot, control: controlState };
    },
  });
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  assert.equal((await fetch(`${origin}/status`)).status, 401);
  assert.equal((await fetch(`${origin}/status`, { headers: { "X-Campus-Lab-Key": "wrong" } })).status, 401);

  const response = await fetch(`${origin}/status`, { headers: { "X-Campus-Lab-Key": proxyKey } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);

  const write = await fetch(`${origin}/status`, { method: "POST", headers: { "X-Campus-Lab-Key": proxyKey } });
  assert.equal(write.status, 405);
  assert.match((await write.json()).error, /read-only/);

  assert.equal((await fetch(`${origin}/control`, { method: "POST" })).status, 401);
  const control = await fetch(`${origin}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Campus-Lab-Key": proxyKey },
    body: JSON.stringify({ enabled: false, clock_mode: "1m" }),
  });
  assert.equal(control.status, 200);
  assert.equal((await control.json()).control.enabled, false);
  assert.deepEqual(controlState, { enabled: false, clock_mode: "1m", duration_seconds: 3_600 });

  const invalid = await fetch(`${origin}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Campus-Lab-Key": proxyKey },
    body: JSON.stringify({ enabled: "yes" }),
  });
  assert.equal(invalid.status, 400);

  const invalidDuration = await fetch(`${origin}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Campus-Lab-Key": proxyKey },
    body: JSON.stringify({ enabled: true, duration_seconds: 120 }),
  });
  assert.equal(invalidDuration.status, 400);

  const invalidMode = await fetch(`${origin}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Campus-Lab-Key": proxyKey },
    body: JSON.stringify({ enabled: true, clock_mode: "fast" }),
  });
  assert.equal(invalidMode.status, 400);
});
