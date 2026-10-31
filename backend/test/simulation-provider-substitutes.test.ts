import { afterEach, describe, expect, it, vi } from "vitest";
import { createSimulationExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { EXECUTION_EFFECT_KINDS } from "../src/campus-model-core/execution-effects.contracts.js";
import {
  ExecutionEffectRouter,
  RunScopedInMemoryExecutionEffectSink,
} from "../src/campus-model-core/execution-effects.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { MatrixClient } from "../src/chat/matrix/matrix-client.js";
import { MatrixTransportService } from "../src/chat/matrix/matrix-transport.service.js";
import {
  bindSimulationResources,
  simulationLogicalDigest,
  unbindSimulationResources,
  type SimulationArtifactPort,
} from "../src/common/simulation-resources.js";
import { PhotoAttendanceVisionClient } from "../src/photo-attendance/vision-client.js";

const virtualNow = "2032-04-05T06:07:08.000Z";
const environment = createSimulationExecutionEnvironment({
  institution_id: "10000000-0000-4000-8000-000000000001",
  scenario_id: "20000000-0000-4000-8000-000000000001",
  run_id: "30000000-0000-4000-8000-000000000001",
  virtual_clock: {
    now: () => new Date(virtualNow),
    nowIso: () => virtualNow,
    advanceBy: () => { throw new Error("test clock is immutable"); },
    advanceTo: () => { throw new Error("test clock is immutable"); },
  },
  source_snapshot_ref: "sha256:provider-substitute-test",
  coverage_gate: { status: "passed", manifest_ref: "simulation-conformance:test", checked_at: virtualNow },
  expires_at: "9999-12-31T23:59:59.999Z",
});

function resources() {
  const contents = new Map<string, Buffer>();
  const writeArtifact = vi.fn<SimulationArtifactPort["write"]>((key, data, exclusive) => {
    if (exclusive && contents.has(key)) throw new Error("exists");
    contents.set(key, Buffer.from(data));
    return Promise.resolve();
  });
  const artifacts: SimulationArtifactPort = {
    write: writeArtifact,
    read: vi.fn((key) => Promise.resolve(contents.get(key) ?? null)),
    rename: vi.fn((from, to) => {
      const value = contents.get(from);
      if (!value) throw new Error("missing");
      contents.delete(from);
      contents.set(to, value);
      return Promise.resolve();
    }),
    remove: vi.fn((key) => { contents.delete(key); return Promise.resolve(); }),
  };
  const router = new ExecutionEffectRouter();
  const sinks = EXECUTION_EFFECT_KINDS.map((kind) => (
    new RunScopedInMemoryExecutionEffectSink(kind, `provider-test:${kind}`, environment)
  ));
  router.bindSimulationSinks({ environment, sinks });
  bindSimulationResources({ environment, effects: router, artifacts, effectReplay: {
    lookupEffectTiming: (kind, idempotencyKey) => {
      const record = sinks.find((sink) => sink.kind === kind)?.records()
        .find((item) => item.intent.idempotency_key === idempotencyKey);
      return Promise.resolve(record ? { requested_at: record.intent.requested_at } : null);
    },
  } });
  return { artifacts, contents, sinks, writeArtifact };
}

afterEach(() => {
  unbindSimulationResources(environment.namespace_id);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Simulation provider substitutes", () => {
  it("captures Matrix operations, persists run-local membership and never reads Live configuration or network", async () => {
    const runtime = resources();
    vi.stubEnv("MATRIX_ENABLED", "true");
    vi.stubEnv("MATRIX_INTERNAL_URL", "not-a-live-provider-url");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Live Matrix must not be reached"));
    const settings = {
      enabled: false,
      baseUrl: "",
      serverName: "",
      asToken: "",
      botLocalpart: "eduvera_bot",
      requestTimeoutMs: 10,
    };

    await executionEnvironmentStorage.run(environment, async () => {
      // Invalid Live settings would throw if the transport touched them; its
      // Simulation adapter is selected first and contains no credential.
      expect(new MatrixTransportService({} as never).client.available).toBe(true);
      const client = new MatrixClient(settings, fetcher);
      expect(client.available).toBe(true);
      const room = await client.ensureRoom(environment.institution_id, "40000000-0000-4000-8000-000000000001");
      const member = client.userId(environment.institution_id, "50000000-0000-4000-8000-000000000001");
      expect(room).toMatch(/^!sim_[a-f0-9]+:simulation\.invalid$/u);
      expect(member).toMatch(/:simulation\.invalid$/u);
      await client.join(room, member);
      expect(await client.joinedMembers(room)).toEqual(expect.arrayContaining([client.botId, member]));
      const event = await client.send(room, member, "transaction-1", { body: "Synthetic message", msgtype: "m.text" });
      expect(await client.send(room, member, "transaction-1", { body: "Synthetic message", msgtype: "m.text" })).toBe(event);
      expect(event).toMatch(/^\$sim_[a-f0-9]+$/u);

      // A new adapter instance reopens the same durable run-local state.
      const reopened = new MatrixClient(settings, fetcher);
      expect(await reopened.joinedMembers(room)).toEqual(expect.arrayContaining([reopened.botId, member]));
      await reopened.kick(room, member);
      expect(await reopened.joinedMembers(room)).not.toContain(member);
      await reopened.redact(room, event, "redact-1");
      expect(await reopened.request<{ user_id: string }>("GET", "/_matrix/client/v3/account/whoami"))
        .toEqual({ user_id: reopened.botId });

      const later = createSimulationExecutionEnvironment({
        institution_id: environment.institution_id,
        scenario_id: environment.scenario_id,
        run_id: environment.run_id,
        virtual_clock: { now: () => new Date("2032-04-06T06:07:08.000Z"), nowIso: () => "2032-04-06T06:07:08.000Z",
          advanceBy: () => { throw new Error("test clock is immutable"); }, advanceTo: () => { throw new Error("test clock is immutable"); } },
        source_snapshot_ref: environment.source_snapshot_ref,
        coverage_gate: environment.coverage_gate,
        expires_at: environment.expires_at,
      });
      await executionEnvironmentStorage.run(later, async () => {
        // Stable logical events reuse the first envelope instead of conflicting
        // merely because virtual time advanced.
        expect(await reopened.ensureRoom(environment.institution_id, "40000000-0000-4000-8000-000000000001"))
          .toBe(room);
      });
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(runtime.writeArtifact.mock.calls.length).toBeGreaterThan(0);
    expect(runtime.sinks.find((sink) => sink.kind === "operational_message")?.records().length).toBeGreaterThan(0);
    expect(runtime.sinks.find((sink) => sink.kind === "connector_call")?.records().length).toBeGreaterThan(0);
  });

  it("keeps simulated photo analysis manual-only, durable and free of source media", async () => {
    const runtime = resources();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error("Live vision must not be reached"));
    vi.stubGlobal("fetch", fetcher);
    const photo = Buffer.from("not-a-real-photo-secret");

    await executionEnvironmentStorage.run(environment, async () => {
      const client = new PhotoAttendanceVisionClient();
      expect(client.available).toBe(true);
      expect(await client.health()).toMatchObject({ backend: "simulation_manual_review", accuracy_validated: false });
      expect(await client.llmStatus()).toMatchObject({ available: false, provider: "disabled" });
      const classroom = await client.createClass("Simulation Year 7");
      const student = await client.createStudent(classroom.id, {
        roll_number: "7",
        name: "Synthetic Learner",
        authorization_record: "scenario-only authorization | edura-student:test",
      });
      expect((await client.enroll(student.id, { filename: "room.jpg", mimetype: "image/jpeg", data: photo })))
        .toMatchObject({ student_id: student.id, added: 1, total_samples: 1, model_id: "simulation-manual-review-v1" });

      const analyzed = await client.analyze(classroom.id, {
        file: { filename: "room.jpg", mimetype: "image/jpeg", data: photo },
        date: "2032-04-05",
        period: "Morning",
        useLlm: true,
      });
      expect(analyzed.result).toMatchObject({
        model_id: "simulation-manual-review-v1",
        faces: [],
        automatic_assignments: [],
        summary: { detected_faces: 0, auto_present: 0 },
        provenance: {
          environment: "simulation",
          decision_mode: "synthetic_manual_review",
          biometric_matching_performed: false,
          automatic_assignments_permitted: false,
          source_media_retained: false,
        },
      });
      expect(analyzed.result.warnings.join(" ")).toMatch(/manual review/i);

      // A new client reads the same artifact after a process-style adapter restart.
      const reopened = new PhotoAttendanceVisionClient();
      expect(await reopened.session(analyzed.id)).toEqual(analyzed);

      const later = createSimulationExecutionEnvironment({
        institution_id: environment.institution_id,
        scenario_id: environment.scenario_id,
        run_id: environment.run_id,
        virtual_clock: { now: () => new Date("2032-04-06T06:07:08.000Z"), nowIso: () => "2032-04-06T06:07:08.000Z",
          advanceBy: () => { throw new Error("test clock is immutable"); }, advanceTo: () => { throw new Error("test clock is immutable"); } },
        source_snapshot_ref: environment.source_snapshot_ref,
        coverage_gate: environment.coverage_gate,
        expires_at: environment.expires_at,
      });
      await executionEnvironmentStorage.run(later, async () => {
        expect(await reopened.health()).toMatchObject({ backend: "simulation_manual_review" });
      });

      // Corrupt or forged run-local output can never introduce an automatic identity assignment.
      const sessionKey = simulationLogicalDigest(`vision:session:${analyzed.id}`);
      runtime.contents.set(sessionKey, Buffer.from(JSON.stringify({
        ...analyzed,
        result: { ...analyzed.result, automatic_assignments: [{ face_id: "forged", student_id: student.id }] },
      })));
      await expect(reopened.session(analyzed.id)).rejects.toThrow(/unavailable/i);
    });

    expect(fetcher).not.toHaveBeenCalled();
    for (const value of runtime.contents.values()) expect(value.includes(photo)).toBe(false);
    const compute = runtime.sinks.find((sink) => sink.kind === "external_compute_call");
    expect(compute?.records()).toHaveLength(2);
    expect(compute?.records().every((record) => (
      record.intent.payload && typeof record.intent.payload === "object"
      && !Array.isArray(record.intent.payload)
      && (record.intent.payload as Record<string, unknown>).provider_contacted !== true
    ))).toBe(true);
  });
});
