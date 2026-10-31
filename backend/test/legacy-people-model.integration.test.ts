import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { DatabaseService } from "../src/database/database.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { LegacyPeopleModelService } from "../src/operations/legacy-people-model.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import type { AuthUser } from "../src/common/request.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const databaseUrl = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/unused_test";

describe.runIf(enabled)("compatibility people writers register canonical Digital Twin identities", () => {
  let db: DatabaseService, core: CampusModelCoreService, operations: OperationsService;
  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    db = new DatabaseService(); core = new CampusModelCoreService(db);
    operations = new OperationsService(db, {} as never, undefined, new LegacyPeopleModelService(core, core, core));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => db.destroy());

  async function fixture() {
    const suffix = randomUUID();
    const account = await db.insertInto("users").values({ username: `legacy-people-${suffix}`, email: `legacy-people-${suffix}@example.test`,
      password_hash: "isolated-fixture-only", first_name: "Campus", last_name: "Owner", role: "admin" })
      .returning(["id", "username", "email", "first_name", "last_name", "role", "is_active"]).executeTakeFirstOrThrow();
    const schoolId = await db.transaction().execute(tx => new ProgressiveWorkspaceProvisioner(core).createForAccount(tx, account, "Asia/Kolkata"));
    const user: AuthUser = { ...account, active_school_id: schoolId };
    const term = await db.insertInto("academic_terms").values({ school_id: schoolId, academic_year: "2026-27", name: "Reviewed intake",
      starts_on: "2026-01-01", ends_on: "2027-12-31", attendance_threshold: "75", is_active: true })
      .returning("id").executeTakeFirstOrThrow();
    const section = await db.insertInto("class_sections").values({ school_id: schoolId, academic_year: "2026-27", grade: "Intake", section: "A" })
      .returning("id").executeTakeFirstOrThrow();
    const input = (roll = 1) => ({ email: `legacy-recipient-${randomUUID()}@example.test`, first_name: "Canonical", last_name: `Person ${roll}`,
      admission_number: `INTAKE-${randomUUID()}`, class_section_id: section.id, term_id: term.id, roll_number: roll });
    return { user, schoolId, input };
  }

  async function registrations(schoolId: string) {
    return (await sql<{ domain_id: string; payload: { source_command_id: string; account_created: boolean }; state: string }>`
      SELECT entity.domain_id,event.payload,command.state FROM campus_model_events event
      JOIN campus_model_entities entity ON entity.id=event.subject_entity_id
      JOIN campus_model_commands command ON command.id=(event.payload->>'source_command_id')::uuid
      WHERE event.school_id=${schoolId}::uuid AND event.payload->>'action'='person_identity_registered'`.execute(db)).rows;
  }

  it("prepares a reviewed command before creating the account/person and immediately registers the exact person", async () => {
    const f = await fixture(), input = f.input(), original = core.prepareDomainCommand.bind(core);
    const prepared = vi.spyOn(core, "prepareDomainCommand").mockImplementation(async (tx, command) => {
      if (command.command_type === "people.legacy_student.create") {
        expect(await tx.selectFrom("users").select("id").where("email", "=", input.email).execute()).toEqual([]);
        expect(command.safe_context).toMatchObject({ source_operation: command.command_type, source_revision: 0 });
        expect(command.safe_context.request_hash).toMatch(/^[a-f0-9]{64}$/);
      }
      return original(tx, command);
    });
    const student = await operations.student(f.user, f.schoolId, input);
    expect(prepared).toHaveBeenCalled();
    expect(await registrations(f.schoolId)).toEqual([{ domain_id: student.person_id,
      payload: expect.objectContaining({ account_created: true, source_command_id: expect.any(String) }), state: "accepted" }]);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_agents
      WHERE school_id=${f.schoolId}::uuid`.execute(db)).rows[0]!.count).toBe(1);
  });

  it("uses one prepared import command for a bounded batch but retains each new person identity", async () => {
    const f = await fixture(), rows = [f.input(1), f.input(2), f.input(3)];
    const columns = ["email", "first_name", "last_name", "admission_number", "class_section_id", "term_id", "roll_number"] as const;
    const csv = [columns.join(","), ...rows.map(row => columns.map(key => row[key]).join(","))].join("\n");
    expect(await operations.importStudents(f.user, f.schoolId, { csv, confirm: true })).toMatchObject({ confirmed: true, count: 3 });
    const retained = await registrations(f.schoolId);
    expect(retained).toHaveLength(3);
    expect(new Set(retained.map(row => row.payload.source_command_id)).size).toBe(1);
    expect(retained.every(row => row.state === "accepted")).toBe(true);
    expect((await db.selectFrom("students").select("person_id").where("school_id", "=", f.schoolId).execute())
      .map(row => row.person_id).sort()).toEqual(retained.map(row => row.domain_id).sort());
  });

  it("does not retain the superseded account-coupled guardian creator",()=>{
    expect(OperationsService.prototype).not.toHaveProperty("guardian");
  });

  it("rolls back accounts, people, enrollment and commands when Model Core registration fails", async () => {
    const f = await fixture(), input = f.input();
    vi.spyOn(core, "recordAcceptedEvent").mockRejectedValueOnce(new Error("Isolated model journal refusal"));
    await expect(operations.student(f.user, f.schoolId, input)).rejects.toThrow("model journal refusal");
    expect(await db.selectFrom("users").select("id").where("email", "=", input.email).execute()).toEqual([]);
    expect(await db.selectFrom("students").select("id").where("school_id", "=", f.schoolId).execute()).toEqual([]);
    expect(await registrations(f.schoolId)).toEqual([]);
    expect((await sql<{ count: number }>`SELECT count(*)::int AS count FROM campus_model_commands
      WHERE school_id=${f.schoolId}::uuid AND command_type='people.legacy_student.create'`.execute(db)).rows[0]!.count).toBe(0);
  });
});
