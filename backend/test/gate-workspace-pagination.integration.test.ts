import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { GateController } from "../src/gate/gate.controller.js";
import { GateService } from "../src/gate/gate.service.js";
import { ProgressiveSetupService } from "../src/institution-activation/progressive-setup.service.js";
import { ProgressiveWorkspaceProvisioner } from "../src/institution-onboarding/progressive-workspace.provisioner.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import type { AuthenticatedRequest, AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";

const enabled = process.env.TEST_DATABASE_ISOLATED === "true";
const pool = new Pool({ connectionString: enabled ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
  : "postgresql://invalid.invalid/unused", max: 2 });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const applicationDb = db as DatabaseService;
const core = new CampusModelCoreService(applicationDb);
const setup = new ProgressiveSetupService(applicationDb, core, core, core);
const gate = new GateService(applicationDb, new SchoolEventService(applicationDb), core);
const controller = new GateController(gate);
afterAll(async () => { await db.destroy(); });

async function fixture() {
  const suffix = randomUUID();
  const account = await db.insertInto("users").values({ username: `gate-page-${suffix}`,
    email: `gate-page-${suffix}@example.test`, password_hash: "isolated-test-only",
    first_name: "Gate", last_name: "Operator", role: "admin",
  }).returning(["id", "email", "first_name", "last_name", "username", "role", "is_active"]).executeTakeFirstOrThrow();
  const schoolId = await db.transaction().execute(transaction =>
    new ProgressiveWorkspaceProvisioner(core).createForAccount(transaction, account, "Asia/Kolkata"));
  const user: AuthUser = { ...account, active_school_id: schoolId };
  await setup.setupGate(user, schoolId, { gate_name: "Pagination reception",
    operator: { kind: "current_user", confirm: true } }, { authUser: user, requestId: randomUUID() } as AuthenticatedRequest);
  return { user, schoolId };
}

describe.skipIf(!enabled)("bounded Gate visitor workspace", () => {
  it("keeps old active work ahead of more than 100 closed visits and returns truthful bounded pages", async () => {
    const { user, schoolId } = await fixture();
    await pool.query(`INSERT INTO gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,
      created_at,expires_at,checked_in_at,checked_out_at)
      SELECT $1,'Closed '||n,'9999999999','Isolated pagination fixture',$2,$2,'out',
        now()-interval '1 hour',now()+interval '1 hour',now()-interval '1 hour',now()
      FROM generate_series(1,120) n`, [schoolId, user.id]);
    const insideId = (await pool.query<{ id: string }>(`INSERT INTO gate_visitors(school_id,name,phone,purpose,
      host_user_id,recorded_by,state,created_at,expires_at,checked_in_at)
      VALUES($1,'Older inside','9999999999','Still open',$2,$2,'inside',now()-interval '2 days',now()-interval '1 day',now()-interval '2 days')
      RETURNING id`, [schoolId, user.id])).rows[0]!.id;
    await pool.query(`INSERT INTO gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,created_at,expires_at)
      SELECT $1,state,'9999999999','Still actionable',$2,$2,state,now()-interval '2 days',now()+interval '1 hour'
      FROM unnest(ARRAY['pending','approved']) state`, [schoolId, user.id]);
    await pool.query(`INSERT INTO gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,created_at,expires_at)
      VALUES($1,'Expired approval','9999999999','Expired fixture',$2,$2,'pending',now()-interval '1 hour',now()-interval '1 minute')`,
    [schoolId, user.id]);
    const first = await controller.workspace({ authUser: user } as AuthenticatedRequest, schoolId);
    expect(first.visitor_counts).toEqual({ all: 124, active: 3, inside: 1, approved: 1, pending: 1, closed: 121 });
    expect(first.pending).toBe(1);
    expect(first.visitors).toHaveLength(25);
    expect(first.visitors.slice(0, 3).map(visitor => visitor.state)).toEqual(["inside", "approved", "pending"]);
    expect(first.visitors[0]!.id).toBe(insideId);
    expect(first.visitor_pagination).toEqual({ page: 1, page_size: 25, total: 124, total_pages: 5,
      has_previous: false, has_next: true, filter: "all" });
    const seen = new Set<string>();
    for (let page = 1; page <= 5; page++) {
      const next = await gate.workspace(user, schoolId, { visitor_page: page });
      expect(next.visitors.length).toBeLessThanOrEqual(25);
      for (const visitor of next.visitors) {
        expect(seen.has(visitor.id)).toBe(false);
        seen.add(visitor.id);
      }
    }
    expect(seen.size).toBe(124);
    const expired = await gate.workspace(user, schoolId, { visitor_filter: "closed", visitor_page: 100 });
    expect(expired.visitor_pagination).toMatchObject({ page: 5, total: 121, total_pages: 5, has_next: false });
    expect(expired.visitors.every(visitor => ["out", "denied", "expired"].includes(visitor.state))).toBe(true);
    expect((await gate.workspace(user, schoolId, { visitor_filter: "active" })).visitors).toHaveLength(3);
    expect((await gate.workspace(user, schoolId, { visitor_filter: "pending" })).visitors.map(visitor => visitor.state)).toEqual(["pending"]);
  });

  it("makes every active page reachable and resolves exact deep links independently of the page/history horizon", async () => {
    const { user, schoolId } = await fixture();
    await pool.query(`INSERT INTO gate_visitors(school_id,name,phone,purpose,host_user_id,recorded_by,state,created_at,expires_at,checked_in_at)
      SELECT $1,'Inside '||n,'9999999999','Active overflow',$2,$2,'inside',now()-interval '2 days',now()-interval '1 day',now()-interval '2 days'
      FROM generate_series(1,61) n`, [schoolId, user.id]);
    const oldClosed = (await pool.query<{ id: string }>(`INSERT INTO gate_visitors(school_id,name,phone,purpose,
      host_user_id,recorded_by,state,created_at,expires_at,checked_in_at,checked_out_at)
      VALUES($1,'Historical deep link','9999999999','Closed',$2,$2,'out',now()-interval '3 days',now()-interval '2 days',now()-interval '3 days',now()-interval '2 days')
      RETURNING id`, [schoolId, user.id])).rows[0]!.id;
    const ids = new Set<string>();
    for (let page = 1; page <= 3; page++) {
      const result = await controller.workspace({ authUser: user } as AuthenticatedRequest, schoolId, String(page), "inside", oldClosed);
      expect(result.visitor_counts.inside).toBe(61);
      expect(result.visitor_pagination).toMatchObject({ page, total: 61, total_pages: 3 });
      expect(result.visitors).toHaveLength(page < 3 ? 25 : 11);
      expect(result.focused_visitor).toMatchObject({ id: oldClosed, state: "out" });
      result.visitors.forEach(visitor => ids.add(visitor.id));
    }
    expect(ids.size).toBe(61);
    const outsider = await fixture();
    expect((await gate.workspace(outsider.user, outsider.schoolId, { visitor_id: oldClosed })).focused_visitor).toBeNull();
    await expect(gate.workspace(outsider.user, schoolId)).rejects.toThrow("Manage In & Out permission");
    for (const query of [{ visitor_page: 0 }, { visitor_page: "1e30" }, { visitor_filter: "arbitrary" }, { visitor_id: "not-an-id" }]) {
      await expect(gate.workspace(user, schoolId, query)).rejects.toThrow();
    }
    const untouched = await pool.query(`SELECT DISTINCT state,revision FROM gate_visitors WHERE school_id=$1 AND state='inside'`, [schoolId]);
    expect(untouched.rows).toEqual([{ state: "inside", revision: 1 }]);
  });
});
