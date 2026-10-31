import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { createSimulationBranch, SimulationBranchDriver } from "../src/database/simulation-branch.driver.js";
import { SimulationSnapshotStore, type StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationRequestEnvironment } from "../src/database/simulation-world.service.js";
import { createResourceLoanFixture, resourceLoanRequest, resourceLoanServices } from "./resource-loans.test-support.js";
import { addResourceCustodian } from "./resource-custody.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const source = enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL) : "postgresql://invalid.invalid/resource_loan_worlds_unused_test";
const target = process.env.RESOURCE_LOANS_SIMULATION_TEST_TARGET_URL;
types.setTypeParser(1082, value => value);
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString: source, max: 3 }) }) }) as DatabaseService;
beforeAll(() => { process.env.INVITATION_EMAIL_ENABLED = "false"; });
afterAll(() => db.destroy());

async function openWorld(store: SimulationSnapshotStore, snapshot: StoredSimulationSnapshot, schoolId: string) {
  const runId = randomUUID(), scenarioId = randomUUID(), namespace = `scenario:${scenarioId}:run:${runId}` as const;
  const branch = await createSimulationBranch(store.pool, snapshot, { run_id: runId, school_id: schoolId,
    scenario_id: scenarioId, namespace_id: namespace });
  const driver = new SimulationBranchDriver(store.pool, branch, snapshot), compiler = new PostgresDialect({ pool: store.pool });
  const database = new Kysely<Database>({ dialect: { createDriver: () => driver, createAdapter: () => compiler.createAdapter(),
    createQueryCompiler: () => compiler.createQueryCompiler(), createIntrospector: connection => compiler.createIntrospector(connection) } }) as DatabaseService;
  const environmentAt = (at: string) => simulationRequestEnvironment({ institution_id: schoolId, scenario_id: scenarioId,
    run_id: runId, virtual_now: at, source_snapshot_ref: `sha256:${snapshot.content_hash}`,
    manifest_ref: "resource-loan-custody-world-test", checked_at: snapshot.captured_at });
  return { ...resourceLoanServices(database), namespace,
    run: <T>(fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(snapshot.captured_at), fn),
    runAt: <T>(at: string, fn: () => Promise<T>) => executionEnvironmentStorage.run(environmentAt(at), fn) };
}

const list = { view: "loans", state: "all", search: "", page: 1 };
const after = (instant: string, milliseconds: number) => new Date(Date.parse(instant) + milliseconds).toISOString();

describe.skipIf(!enabled || !target)("Resources custody in actual isolated COW worlds", () => {
  it("hands captured outstanding custody and old question work to a successor without changing source or sibling",async()=>{
    const f=await createResourceLoanFixture(db),next=await addResourceCustodian(f);
    let original=await next.run(()=>f.resources.issue(f.user,f.schoolId,{command_id:randomUUID(),expected_revision:0,holding_id:f.holdingId,borrower_person_id:f.borrowerPersonId,due_at:after(next.now,86_400_000),custody_confirmed:true,custody_purpose:"Fictional captured continuity kit",components:[{label:"Charger",quantity:1}]}));
    original=await next.run(()=>f.resources.ask(f.borrower,f.schoolId,original.id,{command_id:randomUUID(),expected_revision:original.revision,kind:"question",note:"Captured private question remains source owned"}));
    original=await next.run(()=>f.resources.recordReturn(f.user,f.schoolId,original.id,{command_id:randomUUID(),expected_revision:original.revision,observed_at:next.now,parts:[{part_id:original.parts.find(part=>part.kind==="item")!.id,quantity:1,condition:"usable"}]}));
    const store=new SimulationSnapshotStore(source,requireIsolatedTestDatabaseUrl(target),3),opened:DatabaseService[]=[];
    try{
      const snapshot=await store.capture(f.schoolId,next.now),world=await openWorld(store,snapshot,f.schoolId),sibling=await openWorld(store,snapshot,f.schoolId);opened.push(world.db,sibling.db);
      await world.run(async()=>{
        const input={command_id:randomUUID(),expected_revision:original.revision,custodian_person_id:next.personId,reason:"Branch-only library desk handover"};
        let loan=await world.resources.changeCustodian(f.user,f.schoolId,original.id,input);
        expect(loan).toMatchObject({revision:original.revision+1,outstanding_count:1,custodian:{id:next.personId}});
        expect(await world.resources.changeCustodian(f.user,f.schoolId,loan.id,input)).toMatchObject({revision:loan.revision});
        const incoming=(await world.resources.work(next.user,f.schoolId)).needs_me[0]!;expect(incoming).toMatchObject({question_id:original.questions[0]!.id,reviewer:{user_id:next.user.id}});
        const remaining=loan.parts.find(part=>part.outstanding_quantity>0)!;
        loan=await world.resources.recordReturn(next.user,f.schoolId,loan.id,{command_id:randomUUID(),expected_revision:loan.revision,observed_at:next.now,parts:[{part_id:remaining.id,quantity:1,condition:"usable"}]});
        loan=await world.resources.answer(next.user,f.schoolId,loan.id,original.questions[0]!.id,{command_id:randomUUID(),expected_revision:loan.revision,note:"Branch successor checked the remaining return"},true);
        expect(loan).toMatchObject({state:"returned",outstanding_count:0});expect(loan.questions[0]!.state).toBe("resolved");
        const command=await world.db.selectFrom("campus_model_commands").select(["state","environment_namespace_id"]).where("school_id","=",f.schoolId).where("command_type","=","resource_loans.custody.change").executeTakeFirstOrThrow();expect(command).toEqual({state:"accepted",environment_namespace_id:world.namespace});
      });
      await sibling.run(async()=>expect(await sibling.resources.detail(f.user,f.schoolId,original.id)).toMatchObject({revision:original.revision,outstanding_count:1,custodian:{id:f.custodianPersonId},questions:[{state:"open"}]}));
      await next.run(async()=>expect(await f.resources.detail(f.user,f.schoolId,original.id)).toMatchObject({revision:original.revision,outstanding_count:1,custodian:{id:f.custodianPersonId},questions:[{state:"open"}]}));
      expect(await db.selectFrom("resource_loan_receipts").select("id").where("loan_id","=",original.id).where("action","=","custody_changed").execute()).toEqual([]);
    }finally{await Promise.all(opened.map(item=>item.destroy()));await store.pool.end();}
  },120_000);
  it("issues, reports, receives, corrects and settles only the selected world with exact current authority", async () => {
    const f = await createResourceLoanFixture(db), store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3);
    const opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const world = await openWorld(store, snapshot, f.schoolId); opened.push(world.db);
      const sibling = await openWorld(store, snapshot, f.schoolId); opened.push(sibling.db);
      const batch = { command_id: randomUUID(), campus_id: f.campusId, name: "Fictional branch cameras", quantity: 10 };
      let batchIds: string[] = [];
      const command = { command_id: randomUUID(), expected_revision: 0, holding_id: f.holdingId,
        borrower_person_id: f.borrowerPersonId, due_at: after(f.now, 86_400_000), custody_confirmed: true,
        custody_purpose: "Fictional branch project work", components: [{ label: "Charger", quantity: 1 }] };
      let questionId = "", loanRevision = 0;
      await world.run(async () => {
        const created = await world.resources.createItem(f.user, f.schoolId, batch, resourceLoanRequest(f.user));
        batchIds = created.created_items.map(copy => copy.id);
        expect(created.quantity).toBe(10);
        expect(batchIds[0]).toBe(batch.command_id);
        expect(new Set(batchIds).size).toBe(10);
        const retry = await world.resources.createItem(f.user, f.schoolId, batch, resourceLoanRequest(f.user));
        expect(retry.created_items.map(copy => copy.id)).toEqual(batchIds);
        await expect(world.resources.createItem(f.user, f.schoolId, { ...batch, quantity: 9 }, resourceLoanRequest(f.user)))
          .rejects.toThrow(/different|another|details/i);
        const copies = await world.db.selectFrom("campus_resource_holdings").select(["id", "quantity", "asset_tag"])
          .where("school_id", "=", f.schoolId).where("id", "in", batchIds).execute();
        expect(copies).toHaveLength(10);
        expect(copies.every(copy => copy.quantity === 1 && Boolean(copy.asset_tag))).toBe(true);
        expect(new Set(copies.map(copy => copy.asset_tag)).size).toBe(10);
        const copyCommands = await world.db.selectFrom("campus_model_commands as command")
          .innerJoin("campus_model_entities as target", "target.id", "command.target_entity_id")
          .select(["command.state", "command.environment_namespace_id", "command.safe_context", "target.domain_id"])
          .where("command.school_id", "=", f.schoolId).where("command.handler_key", "=", "campus_topology.lending_item")
          .where("target.domain_id", "in", batchIds).execute();
        expect(copyCommands).toHaveLength(10);
        expect(copyCommands.every(copy => copy.state === "accepted" && copy.environment_namespace_id === world.namespace)).toBe(true);
        expect(copyCommands.every(copy => (copy.safe_context as Record<string, unknown>).batch_command_id === batch.command_id)).toBe(true);
        expect((copyCommands.find(copy => copy.domain_id === batch.command_id)!.safe_context as Record<string, unknown>).created_item_ids).toEqual(batchIds);
        expect(await world.db.selectFrom("event_outbox").select("aggregate_id").where("school_id", "=", f.schoolId)
          .where("event_type", "=", "institution.setup.updated").where("aggregate_id", "in", batchIds).execute()).toHaveLength(10);
        command.holding_id = batchIds[0]!;
        let loan = await world.resources.issue(f.user, f.schoolId, command);
        expect(loan).toMatchObject({ id: command.command_id, revision: 1, state: "outstanding", outstanding_count: 2 });
        expect(await world.resources.issue(f.user, f.schoolId, command)).toMatchObject({ id: loan.id, revision: 1 });
        const availability = (await world.resources.options(f.user, f.schoolId, { search: batch.name })).holdings;
        expect(availability).toHaveLength(10);
        expect(availability.filter(copy => copy.available)).toHaveLength(9);
        expect(availability.find(copy => copy.id === command.holding_id)!.available).toBe(false);
        const privateNote = "Fictional private return claim; this text must never be in refresh events.";
        loan = await world.resources.ask(f.borrower, f.schoolId, loan.id, { command_id: randomUUID(), expected_revision: loan.revision,
          kind: "returned_claim", claimed_return_at: f.now, note: privateNote });
        questionId = loan.questions[0]!.id;
        expect(loan.outstanding_count).toBe(2); // A claimed physical return proves no receipt.
        const incoming = (await world.resources.work(f.user, f.schoolId)).needs_me;
        const waiting = (await world.resources.work(f.borrower, f.schoolId)).waiting;
        expect(incoming).toMatchObject([{ question_id: questionId, state: "review_needed" }]);
        expect(waiting).toMatchObject([{ question_id: questionId, state: "waiting_for_review" }]);
        expect(incoming[0]!.message_id).toBeTruthy(); expect(incoming[0]!.message_id).toBe(waiting[0]!.message_id);
        expect(JSON.stringify([incoming, waiting])).not.toContain(privateNote);
        const item = loan.parts.find(part => part.kind === "item")!, charger = loan.parts.find(part => part.kind === "component")!;
        const received = { command_id: randomUUID(), expected_revision: loan.revision, observed_at: f.now,
          parts: [{ part_id: item.id, quantity: 1, condition: "usable" }] };
        loan = await world.resources.recordReturn(f.user, f.schoolId, loan.id, received);
        expect(loan).toMatchObject({ outstanding_count: 1, state: "outstanding" });
        expect(loan.parts.find(part => part.id === charger.id)!.outstanding_quantity).toBe(1);
        expect((await world.resources.options(f.user, f.schoolId)).holdings.find(row => row.id === command.holding_id)!.available).toBe(false);
        loan = await world.resources.answer(f.user, f.schoolId, loan.id, questionId,
          { command_id: randomUUID(), expected_revision: loan.revision, note: "Camera checked. The charger still needs a physical check." });
        expect((await world.resources.work(f.borrower, f.schoolId)).waiting).toHaveLength(1);
        expect(await world.resources.recordReturn(f.user, f.schoolId, loan.id, received)).toMatchObject({ revision: loan.revision, outstanding_count: 1 });
        loanRevision = loan.revision;
      });
      // The same owning service and SQL now() use this server-selected clock;
      // this is not evidence of the durable background time-advance worker.
      const late = after(f.now, 2 * 86_400_000);
      await world.runAt(late, async () => {
        expect((await sql<{ instant: Date }>`SELECT now() AS instant`.execute(world.db)).rows[0]!.instant.toISOString()).toBe(late);
        let loan = await world.resources.detail(f.user, f.schoolId, command.command_id);
        expect(loan.state).toBe("overdue");
        expect((await world.resources.workspace(f.user, f.schoolId, { ...list, state: "overdue" })).loans).toHaveLength(1);
        const charger = loan.parts.find(part => part.kind === "component")!;
        const correction = { command_id: randomUUID(), expected_revision: loanRevision, observed_at: f.now, correction: true,
          reason: "The charger was physically received but its receipt was missed.", parts: [{ part_id: charger.id, quantity: 1, condition: "usable" }] };
        loan = await world.resources.recordReturn(f.user, f.schoolId, loan.id, correction);
        expect(loan).toMatchObject({ state: "returned", outstanding_count: 0 });
        expect(loan.history[0]).toMatchObject({ action: "return_corrected", observed_at: f.now, recorded_at: late, reason: correction.reason });
        expect((await world.resources.work(f.user, f.schoolId)).needs_me).toHaveLength(1);
        loan = await world.resources.answer(f.user, f.schoolId, loan.id, questionId,
          { command_id: randomUUID(), expected_revision: loan.revision, note: "Camera and charger checked; this private question is settled." }, true);
        expect(loan.questions[0]!.state).toBe("resolved");
        expect(await world.resources.work(f.user, f.schoolId)).toEqual({ needs_me: [], waiting: [] });
        expect((await world.resources.work(f.borrower, f.schoolId)).waiting).toEqual([]);
        expect(await world.resources.recordReturn(f.user, f.schoolId, loan.id, correction)).toMatchObject({ revision: loan.revision, outstanding_count: 0 });
        expect((await world.resources.options(f.user, f.schoolId)).holdings.find(row => row.id === command.holding_id)!.available).toBe(true);
        const traces = await world.db.selectFrom("campus_model_commands").select(["state", "environment_namespace_id"])
          .where("school_id", "=", f.schoolId).where("source_domain", "=", "resource_loans").execute();
        expect(traces.length).toBeGreaterThanOrEqual(8);
        expect(traces.every(row => row.state === "accepted" && row.environment_namespace_id === world.namespace)).toBe(true);
        const envelope = await world.db.selectFrom("event_outbox").selectAll().where("aggregate_id", "=", loan.id)
          .where("event_type", "=", "resources.updated").orderBy("created_at", "desc").executeTakeFirstOrThrow();
        expect(Object.keys(envelope.payload as Record<string, unknown>).sort()).toEqual(["action", "command_id", "loan_id", "refresh", "revision"]);
        expect(JSON.stringify(envelope.payload)).not.toContain("Fictional private");
        const valid = async (payload: unknown) => (await sql<{ valid: boolean }>`SELECT resource_loan_event_source_is_valid(
          ${f.schoolId}::uuid,'resources.updated','resource_loan',${loan.id}::uuid,${JSON.stringify(payload)}::jsonb) AS valid`.execute(world.db)).rows[0]!.valid;
        expect(await valid(envelope.payload)).toBe(true);
        expect(await valid({ ...(envelope.payload as object), note: "private text" })).toBe(false);
        expect(await valid({ ...(envelope.payload as object), command_id: randomUUID() })).toBe(false);
        expect((await sql<{ allowed: boolean }>`SELECT event_user_is_authorized(${f.schoolId}::uuid,
          'resource_loans.issued',${JSON.stringify(envelope.payload)}::jsonb,${f.user.id}::uuid) AS allowed`.execute(world.db)).rows[0]!.allowed).toBe(false);
        // Retained source evidence never keeps a withdrawn operational grant alive.
        await world.db.updateTable("school_memberships").set({ is_active: false }).where("school_id", "=", f.schoolId).where("user_id", "=", f.user.id).execute();
        expect((await sql<{ allowed: boolean }>`SELECT resource_loan_event_is_authorized(${f.schoolId}::uuid,
          ${JSON.stringify(envelope.payload)}::jsonb,${f.user.id}::uuid) AS allowed`.execute(world.db)).rows[0]!.allowed).toBe(false);
        await expect(world.resources.recordReturn(f.user, f.schoolId, loan.id, correction)).rejects.toThrow();
      });
      for (const instance of [sibling]) await instance.run(async () => {
        expect((await instance.resources.workspace(f.user, f.schoolId, list)).loans).toEqual([]);
        expect((await instance.resources.options(f.user, f.schoolId)).holdings.find(row => row.id === f.holdingId)!.available).toBe(true);
        expect(await instance.db.selectFrom("campus_resource_holdings").select("id").where("school_id", "=", f.schoolId)
          .where("id", "in", batchIds).execute()).toEqual([]);
        expect((await instance.resources.work(f.borrower, f.schoolId)).waiting).toEqual([]);
      });
      await f.run(async () => {
        expect((await f.resources.workspace(f.user, f.schoolId, list)).loans).toEqual([]);
        expect((await f.resources.options(f.user, f.schoolId)).holdings.find(row => row.id === f.holdingId)!.available).toBe(true);
        expect(await f.db.selectFrom("campus_resource_holdings").select("id").where("school_id", "=", f.schoolId)
          .where("id", "in", batchIds).execute()).toEqual([]);
        expect((await f.resources.work(f.borrower, f.schoolId)).waiting).toEqual([]);
      });
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);

  it("advances captured custody order on same-instant reissue and refuses to reopen another borrower’s current loan", async () => {
    const f = await createResourceLoanFixture(db), original = await f.run(() => f.resources.issue(f.user, f.schoolId, {
      command_id: randomUUID(), expected_revision: 0, holding_id: f.holdingId, borrower_person_id: f.borrowerPersonId,
      due_at: after(f.now, 86_400_000), custody_confirmed: true, custody_purpose: "Fictional completed loan", components: [],
    }));
    const received = await f.run(() => f.resources.recordReturn(f.user, f.schoolId, original.id, {
      command_id: randomUUID(), expected_revision: original.revision, observed_at: f.now,
      parts: [{ part_id: original.parts[0]!.id, quantity: 1, condition: "usable" }],
    }));
    const receiptId = received.history.find(row => row.action === "return_recorded")!.id;
    const sourceOrder = (await db.selectFrom("resource_loans").select("issue_order").where("id", "=", original.id).executeTakeFirstOrThrow()).issue_order;
    const store = new SimulationSnapshotStore(source, requireIsolatedTestDatabaseUrl(target), 3), opened: DatabaseService[] = [];
    try {
      const snapshot = await store.capture(f.schoolId, f.now);
      const world = await openWorld(store, snapshot, f.schoolId); opened.push(world.db);
      const sibling = await openWorld(store, snapshot, f.schoolId); opened.push(sibling.db);
      await world.run(async () => {
        const next = await world.resources.issue(f.user, f.schoolId, { command_id: randomUUID(), expected_revision: 0,
          holding_id: f.holdingId, borrower_person_id: f.custodianPersonId, due_at: after(f.now, 86_400_000),
          custody_confirmed: true, custody_purpose: "Fictional second borrower at the same clock instant", components: [] });
        const order = (await world.db.selectFrom("resource_loans").select("issue_order").where("id", "=", next.id).executeTakeFirstOrThrow()).issue_order;
        expect(BigInt(order)).toBeGreaterThan(BigInt(sourceOrder));
        expect(next.issued_at).toBe(original.issued_at);
        await expect(world.resources.recordReturn(f.user, f.schoolId, original.id, { command_id: randomUUID(),
          expected_revision: received.revision, observed_at: f.now, correction: true, reason: "Withdraw mistaken old return",
          supersedes_receipt_id: receiptId, parts: [] })).rejects.toThrow(/issued again|current loan/);
        expect(await world.resources.detail(f.user, f.schoolId, original.id)).toMatchObject({ revision: received.revision, state: "returned" });
        expect(await world.resources.detail(f.user, f.schoolId, next.id)).toMatchObject({ revision: 1, state: "outstanding" });
      });
      await sibling.run(async () => expect((await sibling.resources.workspace(f.user, f.schoolId, list)).loans).toMatchObject([{ id: original.id, state: "returned" }]));
      await f.run(async () => expect((await f.resources.workspace(f.user, f.schoolId, list)).loans).toMatchObject([{ id: original.id, state: "returned" }]));
    } finally { await Promise.all(opened.map(database => database.destroy())); await store.pool.end(); }
  }, 120_000);
});
