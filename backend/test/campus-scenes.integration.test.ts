import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import {
  campusSceneDocument,
  campusScenePng,
  createCampusSceneFixture,
} from "./campus-scenes.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { createIndoorSceneFixture } from "./campus-scenes-indoor.test-support.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const url = enabled
  ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/campus_scenes_unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: url, max: 5 }),
  }),
}) as DatabaseService;
const command = (expected_revision: number) => ({
  expected_revision,
  idempotency_key: randomUUID(),
});
beforeAll(() => {
  process.env.INVITATION_EMAIL_ENABLED = "false";
});
afterAll(() => db.destroy());

describe.skipIf(!enabled)("Campus scenes native revision and authority", () => {
  it("requires exact active floors under the mapped connector building at owner and SQL boundaries", async () => {
    const f = await createIndoorSceneFixture(db);
    await f.run(async () => {
      const native = async () => (await sql<{ valid: boolean }>`SELECT campus_scene_links_valid(${f.schoolId}::uuid,${f.campusId}::uuid,${JSON.stringify(f.document)}::jsonb) AS valid`.execute(db)).rows[0]!.valid;
      expect(await native()).toBe(true);
      const wrong = await f.topology.createSpace(f.user, f.schoolId, { campus_id: f.campusId, name: "Other floor", code: "OTHER", kind: "floor" }, resourceLoanRequest(f.user));
      const lift = f.document.elements.find(element => element.id === "lift")!;
      lift.navigation_connector!.to_floor_id = String(wrong.id);
      expect(await native()).toBe(false);
      await expect(f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document: f.document })).rejects.toThrow("floors in its mapped building");
      lift.navigation_connector!.to_floor_id = f.firstId;
      lift.navigation_connector!.accessible = true;
      const save = { ...command(0), document: f.document };
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, save);
      expect(await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, save)).toMatchObject({ replayed: true, revision: 1 });
      await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
      const published = await f.scenes.published(f.borrower, f.schoolId, f.campusId);
      expect(published.scene!.document.elements.find(element => element.id === "lift")!.navigation_connector).toEqual(lift.navigation_connector);
      expect(published.places.map(place => place.id)).toEqual(expect.arrayContaining([f.groundId, f.firstId, f.roomId]));
      await expect(f.scenes.saveDraft(f.borrower, f.schoolId, f.campusId, { ...command(2), document: f.document })).rejects.toThrow("administrator");
    });
  });
  it("validates exact walking endpoints and floors in both owner and native boundaries", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const create = (name: string, kind: string, parent_space_id: string | null = null, campus_id = f.campusId) => f.topology.createSpace(f.user, f.schoolId, { campus_id, name, code: randomUUID().slice(0, 8), kind, parent_space_id }, resourceLoanRequest(f.user));
      const building = await create("Learning building", "building");
      const floor = await create("First floor", "floor", String(building.id));
      const room = await create("Teaching room", "classroom", String(floor.id));
      const secondFloor = await create("Second floor", "floor", String(building.id));
      const other = await f.topology.createCampus(f.user, f.schoolId, { name: "Other campus", code: "OTHER", campus_type: "branch", timezone: "UTC" }, resourceLoanRequest(f.user));
      const otherPlace = await create("Other campus gate", "gate", null, String(other.id));
      const document = campusSceneDocument();
      const walk = document.elements[1]!;
      walk.navigation = { walkable: true, accessible: true, status: "open", start_space_id: null, end_space_id: String(otherPlace.id) };
      const validNative = async () => (await sql<{ valid: boolean }>`SELECT campus_scene_links_valid(${f.schoolId}::uuid,${f.campusId}::uuid,${JSON.stringify(document)}::jsonb) AS valid`.execute(db)).rows[0]!.valid;
      expect(await validNative()).toBe(false);
      await expect(f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document })).rejects.toThrow("active places in this campus");
      walk.navigation.end_space_id = String(room.id);
      expect(await validNative()).toBe(false);
      await expect(f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document })).rejects.toThrow("select the recorded floor");
      walk.floor_id = String(secondFloor.id);
      expect(await validNative()).toBe(false);
      await expect(f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document })).rejects.toThrow("outside its selected floor");
      walk.floor_id = String(floor.id);
      expect(await validNative()).toBe(true);
      const saved = await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document });
      expect(saved.document.elements[1]!.navigation).toEqual(walk.navigation);
      await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
      const publication = await f.scenes.published(f.borrower, f.schoolId, f.campusId);
      expect(publication.scene!.document.elements[1]!.navigation).toEqual(walk.navigation);
      expect(publication.places).toEqual(expect.arrayContaining([expect.objectContaining({ id: room.id }), expect.objectContaining({ id: floor.id })]));
    });
  });
  it("links only exact current campus resources and reads their status without inventing an outage from a label", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const lamp = await f.resources.createItem(f.user, f.schoolId, { command_id: randomUUID(), campus_id: f.campusId, name: "Garden lamp", asset_tag: `LAMP-${randomUUID().slice(0, 8)}` }, resourceLoanRequest(f.user));
      const other = await f.topology.createCampus(f.user, f.schoolId, { name: "Other resources campus", code: "OTHER", campus_type: "branch", timezone: "UTC" }, resourceLoanRequest(f.user));
      const document = campusSceneDocument();
      document.elements.push({ id: "lamp-one", label: "Garden lamp", kind: "fixture", geometry: { type: "point", points: [{ x: 220, y: 200 }] }, space_id: null, floor_id: null, holding_id: lamp.id, asset_key: "lamp", review_state: "reviewed" });
      const choices = await f.scenes.resources(f.user, f.schoolId, f.campusId, { search: "Garden", holding_id: lamp.id });
      expect(choices).toMatchObject({ total: 1, page: 1, page_size: 20, selected: { id: lamp.id } });
      expect(await f.scenes.resources(f.user, f.schoolId, String(other.id), { holding_id: lamp.id })).toMatchObject({ total: 0, selected: null });
      await expect(f.scenes.resources(f.borrower, f.schoolId, f.campusId, {})).rejects.toThrow("administrator");
      await expect(f.scenes.saveDraft(f.user, f.schoolId, String(other.id), { ...command(0), document })).rejects.toThrow("current individual resource");
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, { ...command(0), document });
      await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
      expect(await f.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "lamp-one", holding_id: lamp.id, state: "available" }] });
      expect(await f.scenes.resourceStates(f.borrower, f.schoolId, f.campusId)).toMatchObject({ items: [{ holding_id: lamp.id, state: 'available', reportable: true }] });
      const holding = await db.selectFrom("campus_resource_holdings").selectAll().where("id", "=", lamp.id).executeTakeFirstOrThrow();
      const { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes } = holding;
      const changed = await f.topology.updateAsset(f.user, f.schoolId, lamp.id, { campus_id, space_id, resource_type_id, name, quantity, asset_tag, notes, state: "unavailable", expected_revision: holding.revision }, resourceLoanRequest(f.user));
      expect(await f.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "lamp-one", state: "unavailable" }] });
      const movedAt = new Date(Date.parse(f.now) + 1_000);
      await executionEnvironmentStorage.run(createLiveExecutionEnvironment({ institution_id: f.schoolId, clock: { now: () => movedAt, nowIso: () => movedAt.toISOString() } }), async () => {
        await f.topology.updateAsset(f.user, f.schoolId, lamp.id, { campus_id: String(other.id), space_id, resource_type_id, name, quantity, asset_tag, notes, state: "unavailable", expected_revision: changed.revision }, resourceLoanRequest(f.user));
        expect(await f.scenes.resourceStates(f.user, f.schoolId, f.campusId)).toMatchObject({ items: [{ element_id: "lamp-one", state: "unknown" }] });
        await f.scenes.reopen(f.user, f.schoolId, f.campusId, command(2));
        await expect(f.scenes.publish(f.user, f.schoolId, f.campusId, command(3))).rejects.toThrow("current individual resource");
      });
    });
  });
  it("returns the canonical campus timezone consistently and falls back safely for older invalid setup data", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      for (const [timezone, expected] of [["Pacific/Auckland", "Pacific/Auckland"], ["Unknown/Campus", "UTC"]]) {
        const campus = await f.topology.createCampus(f.user, f.schoolId, {
          name: "Timezone campus", code: `TZ-${randomUUID().slice(0, 8)}`, campus_type: "branch", timezone,
        }, resourceLoanRequest(f.user));
        const id = String(campus.id);
        expect((await f.scenes.directory(f.borrower, f.schoolId)).campuses.find(row => row.id === id)?.timezone).toBe(expected);
        expect((await f.scenes.published(f.borrower, f.schoolId, id)).campus.timezone).toBe(expected);
        expect((await f.scenes.workspace(f.user, f.schoolId, id)).campus.timezone).toBe(expected);
      }
    });
  });

  it("persists draft, exact retries, publication and reopen with stable places and private sources", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const building = await f.topology.createSpace(
        f.user,
        f.schoolId,
        {
          campus_id: f.campusId,
          name: "Library",
          code: "LIB",
          kind: "building",
        },
        resourceLoanRequest(f.user),
      );
      expect(
        (await f.scenes.directory(f.borrower, f.schoolId)).campuses.some(
          (campus) => campus.id === f.campusId,
        ),
      ).toBe(true);
      expect(
        await f.scenes.published(f.borrower, f.schoolId, f.campusId),
      ).toMatchObject({ scene: null, can_edit: false });
      const document = campusSceneDocument(String(building.id));
      Object.assign(document.elements[1]!, { asset_key: "boundary_wall", width: 3, height: 12 });
      document.elements.push({
        id: "courtyard-conifer", label: "Courtyard conifer", kind: "tree",
        geometry: { type: "point", points: [{ x: 90, y: 90 }] },
        asset_key: "tree_conifer", width: 8, height: 14,
        space_id: null, floor_id: null, review_state: "reviewed",
      });
      const input = {
        ...command(0),
        document,
      };
      const saved = await f.scenes.saveDraft(
        f.user,
        f.schoolId,
        f.campusId,
        input,
      );
      expect(saved).toMatchObject({ revision: 1, replayed: false });
      expect(
        await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, input),
      ).toMatchObject({ revision: 1, replayed: true });
      await expect(
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...input,
          document: { ...input.document, name: "Different payload" },
        }),
      ).rejects.toThrow(/different/);
      await expect(
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(0),
          document: input.document,
        }),
      ).rejects.toThrow(/changed/);
      const publish = command(1);
      expect(
        await f.scenes.publish(f.user, f.schoolId, f.campusId, publish),
      ).toMatchObject({ version: 2, draft: null });
      expect(
        await f.scenes.publish(f.user, f.schoolId, f.campusId, publish),
      ).toMatchObject({ version: 2, replayed: true });
      const published = await f.scenes.published(
        f.borrower,
        f.schoolId,
        f.campusId,
      );
      expect(published.scene?.document.elements[0]?.space_id).toBe(building.id);
      expect(published.scene?.document.elements[1]).toMatchObject({
        kind: "path", asset_key: "boundary_wall", width: 3, height: 12,
      });
      expect(published.scene?.document.elements.find(element => element.id === "courtyard-conifer"))
        .toMatchObject({ asset_key: "tree_conifer", width: 8, height: 14 });
      expect(published.places).toMatchObject([
        { id: building.id, kind: "building" },
      ]);
      expect(JSON.stringify(published)).not.toMatch(
        /PRIVATE|private.example|notes|provider|image_asset_id/,
      );
      await expect(
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(2),
          document: input.document,
        }),
      ).rejects.toThrow(/Reopen/);
      const reopen = command(2);
      expect(
        await f.scenes.reopen(f.user, f.schoolId, f.campusId, reopen),
      ).toMatchObject({ revision: 3, published_version: 2 });
      expect(
        await f.scenes.reopen(f.user, f.schoolId, f.campusId, reopen),
      ).toMatchObject({ revision: 3, replayed: true });
      expect(
        await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(3),
          document: { ...input.document, name: "Edited next version" },
        }),
      ).toMatchObject({ revision: 4 });
      expect(
        (await f.scenes.published(f.borrower, f.schoolId, f.campusId)).scene
          ?.document.name,
      ).toBe("Fictional campus");
      const history = await db
        .selectFrom("campus_scene_revisions")
        .selectAll()
        .where("scene_id", "=", f.campusId)
        .orderBy("revision")
        .execute();
      expect(history.map((row) => row.action)).toEqual([
        "draft_saved",
        "published",
        "reopened",
        "draft_saved",
      ]);
      expect(
        await db
          .selectFrom("campus_model_commands")
          .select(["state", "source_domain"])
          .where("id", "=", history[0]!.command_id)
          .executeTakeFirstOrThrow(),
      ).toEqual({ state: "accepted", source_domain: "campus_scenes" });
      const lineage = (
        await sql<{
          count: number;
        }>`SELECT count(*)::int AS count FROM campus_scene_revisions revision JOIN campus_model_commands command ON command.id=revision.command_id JOIN campus_model_command_outcomes outcome ON outcome.command_id=command.id JOIN campus_model_events event ON event.source_outbox_event_id=outcome.domain_event_id WHERE revision.scene_id=${f.campusId}::uuid AND command.state='accepted' AND outcome.resulting_revision=revision.revision AND event.actor_agent_id=command.actor_agent_id AND event.source_revision=revision.revision`.execute(
          db,
        )
      ).rows[0]!;
      expect(lineage.count).toBe(4);
      await expect(
        sql`UPDATE campus_scene_revisions SET document='{}'::jsonb WHERE scene_id=${f.campusId}::uuid`.execute(
          db,
        ),
      ).rejects.toThrow(/immutable/);
      await expect(
        sql`UPDATE campus_visual_scenes SET revision=revision+1 WHERE id=${f.campusId}::uuid`.execute(
          db,
        ),
      ).rejects.toThrow(/immutable source receipt/);
    });
  });
  it("keeps member editing, cross-tenant sources and unreviewed publication out", async () => {
    const f = await createCampusSceneFixture(db),
      other = await createCampusSceneFixture(db);
    await f.run(async () => {
      await expect(
        f.scenes.workspace(f.borrower, f.schoolId, f.campusId),
      ).rejects.toThrow(/administrator/);
      await expect(
        f.scenes.saveDraft(f.borrower, f.schoolId, f.campusId, {
          ...command(0),
          document: campusSceneDocument(),
        }),
      ).rejects.toThrow(/administrator/);
      await expect(
        f.scenes.published(f.user, other.schoolId, other.campusId),
      ).rejects.toThrow(/current world/);
      const doc = campusSceneDocument(randomUUID());
      await expect(
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(0),
          document: doc,
        }),
      ).rejects.toThrow(/active space/);
      doc.elements[0]!.space_id = null;
      doc.elements[0]!.review_state = "needs_review";
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
        ...command(0),
        document: doc,
      });
      await expect(
        f.scenes.publish(f.user, f.schoolId, f.campusId, command(1)),
      ).rejects.toThrow(/Review every/);
      expect(
        (await f.scenes.workspace(f.user, f.schoolId, f.campusId)).scene
          ?.revision,
      ).toBe(1);
      expect(
        (await f.scenes.published(f.borrower, f.schoolId, f.campusId)).scene,
      ).toBeNull();
    });
  });
  it("stores bounded immutable raster bytes and only permits same-campus source linkage", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const input = {
        idempotency_key: randomUUID(),
        rights_confirmed: true,
        data_url: campusScenePng,
      };
      const uploaded = await f.scenes.uploadImage(
        f.user,
        f.schoolId,
        f.campusId,
        input,
      );
      expect(uploaded.image).toMatchObject({
        width: 1,
        height: 1,
        mime_type: "image/png",
      });
      expect(
        await f.scenes.uploadImage(f.user, f.schoolId, f.campusId, input),
      ).toMatchObject({ replayed: true, image: { id: uploaded.image.id } });
      const read = await f.scenes.readImage(
        f.user,
        f.schoolId,
        f.campusId,
        uploaded.image.id,
      );
      expect(
        read.bytes.equals(Buffer.from(campusScenePng.split(",")[1]!, "base64")),
      ).toBe(true);
      await expect(
        f.scenes.readImage(
          f.borrower,
          f.schoolId,
          f.campusId,
          uploaded.image.id,
        ),
      ).rejects.toThrow(/administrator/);
      const document = campusSceneDocument();
      document.source = {
        kind: "aerial_image",
        label: "Uploaded source",
        image_asset_id: uploaded.image.id,
      };
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
        ...command(0),
        document,
      });
      document.source.image_asset_id = randomUUID();
      await expect(
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(1),
          document,
        }),
      ).rejects.toThrow(/source image/);
      await expect(
        sql`UPDATE campus_scene_images SET rights_confirmed=false WHERE id=${uploaded.image.id}::uuid`.execute(
          db,
        ),
      ).rejects.toThrow(/immutable/);
    });
  });
  it("reopens a retained publication so a retired canonical place can be corrected", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const building = await f.topology.createSpace(
        f.user,
        f.schoolId,
        {
          campus_id: f.campusId,
          name: "Former library",
          code: `OLD-${randomUUID().slice(0, 8)}`,
          kind: "building",
        },
        resourceLoanRequest(f.user),
      );
      const document = campusSceneDocument(String(building.id));
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
        ...command(0),
        document,
      });
      await f.scenes.publish(f.user, f.schoolId, f.campusId, command(1));
      await f.topology.updateSpace(
        f.user,
        f.schoolId,
        String(building.id),
        {
          campus_id: f.campusId,
          name: building.name,
          code: building.code,
          kind: "building",
          status: "inactive",
          expected_revision: building.revision,
        },
        resourceLoanRequest(f.user),
      );
      expect(
        await f.scenes.reopen(f.user, f.schoolId, f.campusId, command(2)),
      ).toMatchObject({ revision: 3 });
      await expect(
        f.scenes.publish(f.user, f.schoolId, f.campusId, command(3)),
      ).rejects.toThrow(/active space/);
      document.elements[0]!.space_id = null;
      await f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
        ...command(3),
        document,
      });
      expect(
        await f.scenes.publish(f.user, f.schoolId, f.campusId, command(4)),
      ).toMatchObject({ version: 5 });
    });
  });
  it("serializes competing first saves and preserves one accepted scene", async () => {
    const f = await createCampusSceneFixture(db);
    await f.run(async () => {
      const results = await Promise.allSettled([
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(0),
          document: campusSceneDocument(),
        }),
        f.scenes.saveDraft(f.user, f.schoolId, f.campusId, {
          ...command(0),
          document: { ...campusSceneDocument(), name: "Competing map" },
        }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected"),
      ).toHaveLength(1);
      expect(
        (await f.scenes.workspace(f.user, f.schoolId, f.campusId)).scene
          ?.revision,
      ).toBe(1);
    });
  });
});
