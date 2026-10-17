import assert from "node:assert/strict";
import test from "node:test";
import { startStatusServer } from "../src/status-server.mjs";

const proxyKey = "status-test-key-123456789012345";

test("serves read-only status only to the local proxy key", async (context) => {
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
  const server = await startStatusServer({ port: 0, proxyKey, getStatus: () => snapshot });
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
});
