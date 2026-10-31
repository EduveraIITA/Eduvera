import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import type { AuthUser } from "../src/common/request.js";
import { saveOrganizationSchema, validateOrganization, type OrganizationNode } from "../src/organization/organization.contracts.js";
import { OrganizationService } from "../src/organization/organization.service.js";

const school = randomUUID(), actor = randomUUID(), staff = randomUUID();
const user = { id: actor, is_active: true } as AuthUser;
const node = (overrides: Partial<OrganizationNode> = {}): OrganizationNode => ({ id: randomUUID(), parent_id: null, kind: "department", name: "Academics", description: "", tone: "blue", head_staff_id: null, member_ids: [], ...overrides });

describe("organization invariants", () => {
  it("accepts forests without inventing leadership appointments", () => expect(() => validateOrganization([node(), node()])).not.toThrow());
  it("rejects cycles, missing parents and duplicate identities", () => {
    const a = node(), b = node({ parent_id: a.id });
    expect(() => validateOrganization([{ ...a, parent_id: b.id }, b])).toThrow(/cycle/);
    expect(() => validateOrganization([b])).toThrow(/parent/);
    expect(() => validateOrganization([a, a])).toThrow(/unique/);
  });
  it("bounds depth, payload size and duplicate membership", () => {
    const chain = [node()]; for (let index = 1; index < 13; index++) chain.push(node({ parent_id: chain[index - 1]!.id }));
    expect(() => validateOrganization(chain)).toThrow(/12 levels/);
    expect(() => validateOrganization([node({ member_ids: [staff, staff] })])).toThrow(/once/);
    expect(saveOrganizationSchema.safeParse({ expected_revision: 0, request_id: randomUUID(), nodes: Array.from({ length: 251 }, () => node()) }).success).toBe(false);
  });
});

describe("organization transaction boundary", () => {
  let statements: string[], authorized: boolean, revision: number, availableStaff: boolean, replay: Record<string, unknown> | null;
  const prepare = vi.fn(), complete = vi.fn(), journal = vi.fn();
  let service: OrganizationService;
  beforeEach(() => {
    statements = []; authorized = true; revision = 0; availableStaff = true; replay = null;
    prepare.mockReset().mockResolvedValue({ status: "ready", command_id: randomUUID() }); complete.mockReset().mockResolvedValue({}); journal.mockReset().mockResolvedValue({ event_id: randomUUID() });
    const pool = { connect: () => Promise.resolve({ release: () => undefined, query: (query: string) => Promise.resolve((() => {
      statements.push(query);
      if (query.includes('from "school_memberships"')) return { rows: authorized ? [{ id: randomUUID(), user_id: actor }] : [] };
      if (query.includes("SELECT revision,request_hash,nodes")) return { rows: replay ? [replay] : [] };
      if (query.includes("SELECT revision FROM organization_structures")) return { rows: [{ revision }] };
      if (query.includes('from "staff_profiles"')) return { rows: availableStaff ? [{ id: staff, status: "active" }] : [] };
      if (query.includes('insert into "event_outbox"')) return { rows: [{ id: randomUUID() }] };
      return { rows: [], rowCount: 1 };
    })()) }), end: () => Promise.resolve() };
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool as unknown as Pool }) });
    service = new OrganizationService(db as DatabaseService, { prepareDomainCommand: prepare, completeDomainCommand: complete }, { recordAcceptedEvent: journal });
  });
  const input = () => ({ expected_revision: 0, request_id: randomUUID(), nodes: [node({ head_staff_id: staff, member_ids: [staff] })] });
  it("requires a current active admin before querying or mutating organization records", async () => {
    authorized = false;
    await expect(service.save(user, school, input())).rejects.toThrow(/administrator/);
    expect(prepare).not.toHaveBeenCalled(); expect(statements.some(query => query.includes("organization_nodes"))).toBe(false);
    expect(statements.at(-1)).toBe("rollback");
  });
  it("rejects a cross-institution staff reference and stale revisions before preparing a command", async () => {
    availableStaff = false; await expect(service.save(user, school, input())).rejects.toThrow(/institution/);
    availableStaff = true; revision = 2; await expect(service.save(user, school, input())).rejects.toThrow(/changed since/);
    expect(prepare).not.toHaveBeenCalled();
  });
  it("retains one model-mediated command, accepted event, revision evidence and outcome", async () => {
    const result = await service.save(user, school, input());
    expect(result.revision).toBe(1); expect(prepare).toHaveBeenCalledOnce(); expect(journal).toHaveBeenCalledOnce(); expect(complete).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]![1]).toMatchObject({ source_domain: "organization", capability: "organization:manage", safe_context: { changes_access: false, changes_governance: false } });
    expect(statements.some(query => query.includes("INSERT INTO organization_structure_revisions"))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
  });
  it("rolls domain changes back if the model event cannot be retained", async () => {
    journal.mockRejectedValue(new Error("Journal unavailable"));
    await expect(service.save(user, school, input())).rejects.toThrow(/Journal unavailable/);
    expect(complete).not.toHaveBeenCalled(); expect(statements.at(-1)).toBe("rollback");
  });
  it("replays the exact saved revision without a duplicate effect, and rejects altered retries", async () => {
    const body = input();
    const { createHash } = await import("node:crypto");
    replay = { revision: 1, nodes: body.nodes, request_hash: createHash("sha256").update(JSON.stringify(saveOrganizationSchema.parse(body))).digest("hex") };
    expect(await service.save(user, school, body)).toMatchObject({ revision: 1, replayed: true });
    expect(prepare).not.toHaveBeenCalled();
    await expect(service.save(user, school, { ...body, nodes: [] })).rejects.toThrow(/different changes/);
  });
});
