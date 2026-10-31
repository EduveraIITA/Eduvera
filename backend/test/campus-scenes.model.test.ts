import { describe, expect, it, vi } from "vitest";
import type { Transaction } from "kysely";
import type { Database } from "../src/database/types.js";
import type { AuthUser } from "../src/common/request.js";
import type { ActingHumanAgentIdentity } from "../src/campus-model-core/human-agent-identity.port.js";
import type { DomainCommandGatewayPort } from "../src/campus-model-core/domain-command-gateway.port.js";
import type { DomainEventJournalPort } from "../src/campus-model-core/domain-event-journal.port.js";
import { CampusScenesModel } from "../src/campus-scenes/campus-scenes.model.js";
import { scenePayloadHash } from "../src/campus-scenes/campus-scenes.contracts.js";

const tx = {} as Transaction<Database>,
  school = "54ab5f54-d08d-4073-bb3c-3cc72231affd",
  campus = "d7356078-9eac-43b6-bba5-b4d7da274839",
  key = "e64bbd4b-7a8a-43da-9caa-508d4da7586e";
const user = { id: "31a21eb4-7aca-4af9-a496-b7860e5bd178" } as AuthUser;
const actor = {
  acting: true,
  agent_id: "40384951-f761-480d-98ce-87a9cfc91fe1",
  person_id: "33694722-f1d7-4506-85ba-d31d7ec93852",
} as ActingHumanAgentIdentity;
const target = {
    id: campus,
    campus_id: campus,
    revision: 4,
    kind: "campus_scene" as const,
  },
  body = { expected_revision: 4, idempotency_key: key },
  content = { name: "Campus" };
function harness() {
  const prepare = vi
    .fn()
    .mockResolvedValue({
      status: "ready",
      command_id: "e89cfa23-48c6-4fd7-ae7b-f13d09ebc277",
    });
  const read = vi.fn().mockResolvedValue(null);
  const model = new CampusScenesModel(
    { prepareDomainCommand: prepare } as unknown as DomainCommandGatewayPort,
    { readDomainCommandReceipt: read },
    {} as DomainEventJournalPort,
  );
  return { model, prepare, read };
}
function retained() {
  return {
    command_type: "campus_scenes.draft_saved",
    actor_agent_id: actor.agent_id,
    target: {
      kind: "campus_scene",
      domain: "campus_scenes",
      domain_id: campus,
    },
    expected_revision: 4,
    safe_context: {
      payload_hash: scenePayloadHash({
        target_id: campus,
        campus_id: campus,
        action: "draft_saved",
        expected_revision: 4,
        content,
      }),
    },
    state: "completed",
    receipt: {
      terminal_state: "accepted",
      resulting_revision: 5,
      metadata: { published_revision: 2 },
    },
  };
}
describe("campus scenes exact domain commands", () => {
  it("prepares an attested command before the native scene effect", async () => {
    const { model, prepare } = harness();
    expect(
      await model.prepare(
        tx,
        user,
        actor,
        school,
        target,
        "draft_saved",
        body,
        content,
      ),
    ).toMatchObject({ replayed: false });
    expect(prepare).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        source_domain: "campus_scenes",
        handler_key: "campus_scenes.commands",
        command_type: "campus_scenes.draft_saved",
        current_revision: 4,
        expected_revision: 4,
        authority_attestation: expect.objectContaining({
          evaluator_domain: "campus_scenes",
          reason_codes: [
            "active_institution_administrator",
            "explicit_campus_scene_change",
          ],
        }),
        safe_context: expect.objectContaining({
          source_id: campus,
          campus_id: campus,
        }),
      }),
    );
  });
  it("replays the exact accepted revision after the current stream advances", async () => {
    const { model, prepare, read } = harness();
    read.mockResolvedValue(retained());
    expect(
      await model.prepare(
        tx,
        user,
        actor,
        school,
        { ...target, revision: 9 },
        "draft_saved",
        body,
        content,
      ),
    ).toEqual({
      replayed: true,
      revision: 5,
      metadata: { published_revision: 2 },
    });
    expect(prepare).not.toHaveBeenCalled();
  });
  it("rejects stale first effects and mismatched reuse without preparing another command", async () => {
    const { model, prepare, read } = harness();
    await expect(
      model.prepare(
        tx,
        user,
        actor,
        school,
        { ...target, revision: 5 },
        "draft_saved",
        body,
        content,
      ),
    ).rejects.toThrow(/changed/);
    read.mockResolvedValue(retained());
    await expect(
      model.prepare(tx, user, actor, school, target, "draft_saved", body, {
        name: "Changed",
      }),
    ).rejects.toThrow(/different/);
    await expect(
      model.prepare(
        tx,
        user,
        actor,
        school,
        { ...target, campus_id: school },
        "draft_saved",
        body,
        content,
      ),
    ).rejects.toThrow(/different/);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("keeps pending and rejected receipts from repeating a native effect", async () => {
    const { model, prepare, read } = harness();
    read.mockResolvedValue({ ...retained(), state: "pending", receipt: null });
    await expect(
      model.prepare(
        tx,
        user,
        actor,
        school,
        target,
        "draft_saved",
        body,
        content,
      ),
    ).rejects.toThrow(/awaiting confirmation/);
    read.mockResolvedValue({
      ...retained(),
      receipt: { terminal_state: "rejected" },
    });
    await expect(
      model.prepare(
        tx,
        user,
        actor,
        school,
        target,
        "draft_saved",
        body,
        content,
      ),
    ).rejects.toThrow(/not accepted/);
    expect(prepare).not.toHaveBeenCalled();
  });
});
