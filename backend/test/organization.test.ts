import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";
import { beforeEach, describe, expect, it } from "vitest";
import type { AuthUser } from "../src/common/request.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";
import {
  saveOrganizationSchema,
  validateOrganization,
  type OrganizationNode,
} from "../src/organization/organization.contracts.js";
import { OrganizationService } from "../src/organization/organization.service.js";

const schoolId = randomUUID();
const actorId = randomUUID();
const staffId = randomUUID();
const user = { id: actorId, is_active: true } as AuthUser;

const node = (overrides: Partial<OrganizationNode> = {}): OrganizationNode => ({
  id: randomUUID(),
  parent_id: null,
  kind: "department",
  name: "Academics",
  description: "",
  tone: "blue",
  head_staff_id: null,
  member_ids: [],
  ...overrides,
});

describe("organization invariants", () => {
  it("accepts a forest without inventing authority", () => {
    expect(() => validateOrganization([node(), node()])).not.toThrow();
  });

  it("rejects cycles, missing parents and duplicate identities", () => {
    const root = node();
    const child = node({ parent_id: root.id });
    expect(() => validateOrganization([{ ...root, parent_id: child.id }, child])).toThrow(/cycle/);
    expect(() => validateOrganization([child])).toThrow(/parent/);
    expect(() => validateOrganization([root, root])).toThrow(/unique/);
  });

  it("bounds depth, payload size and duplicate membership", () => {
    const chain = [node()];
    for (let index = 1; index < 13; index += 1) {
      chain.push(node({ parent_id: chain[index - 1]!.id }));
    }
    expect(() => validateOrganization(chain)).toThrow(/12 levels/);
    expect(() => validateOrganization([node({ member_ids: [staffId, staffId] })])).toThrow(/only once/);
    expect(saveOrganizationSchema.safeParse({
      expected_revision: 0,
      request_id: randomUUID(),
      nodes: Array.from({ length: 251 }, () => node()),
    }).success).toBe(false);
  });
});

describe("organization transaction boundary", () => {
  let statements: string[];
  let authorized: boolean;
  let revision: number;
  let availableStaff: boolean;
  let outboxFails: boolean;
  let replay: { revision: number; request_hash: string; nodes: OrganizationNode[] } | null;
  let service: OrganizationService;

  beforeEach(() => {
    statements = [];
    authorized = true;
    revision = 0;
    availableStaff = true;
    outboxFails = false;
    replay = null;
    const pool = {
      connect: () => Promise.resolve({
        release: () => undefined,
        query: (query: string) => {
          statements.push(query);
          if (query.includes('select "school_memberships"."id"')) {
            return Promise.resolve({ rows: authorized ? [{ id: randomUUID() }] : [] });
          }
          if (query.includes("SELECT revision,request_hash,nodes")) {
            return Promise.resolve({ rows: replay ? [replay] : [] });
          }
          if (query.includes("SELECT revision") && query.includes("organization_structures")) {
            return Promise.resolve({ rows: [{ revision }] });
          }
          if (query.includes('from "staff_profiles"')) {
            return Promise.resolve({ rows: availableStaff ? [{ id: staffId, status: "active" }] : [] });
          }
          if (query.includes('select "school_memberships"."user_id"')) {
            return Promise.resolve({ rows: authorized ? [{ user_id: actorId }] : [] });
          }
          if (query.includes('insert into "event_outbox"')) {
            if (outboxFails) return Promise.reject(new Error("Outbox unavailable"));
            return Promise.resolve({ rows: [{ id: randomUUID() }] });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
      }),
      end: () => Promise.resolve(),
    };
    const database = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: pool as unknown as Pool }),
    });
    service = new OrganizationService(database as DatabaseService);
  });

  const input = () => ({
    expected_revision: 0,
    request_id: randomUUID(),
    nodes: [node({ head_staff_id: staffId, member_ids: [staffId] })],
  });

  it("requires a current active administrator before reading organization records", async () => {
    authorized = false;
    await expect(service.workspace(user, schoolId)).rejects.toThrow(/administrator/);
    expect(statements.some((query) => query.includes("organization_nodes"))).toBe(false);
    expect(statements.at(-1)).toBe("rollback");
  });

  it("rejects cross-institution staff and stale revisions before replacing the aggregate", async () => {
    availableStaff = false;
    await expect(service.save(user, schoolId, input())).rejects.toThrow(/institution/);
    availableStaff = true;
    revision = 2;
    await expect(service.save(user, schoolId, input())).rejects.toThrow(/changed since/);
    expect(statements.filter((query) => query.includes("DELETE FROM organization_nodes"))).toHaveLength(0);
  });

  it("retains one revision, audit record and outbox event in the same transaction", async () => {
    const result = await service.save(user, schoolId, input());
    expect(result).toMatchObject({ revision: 1, replayed: false });
    expect(statements.some((query) => query.includes('insert into "audit_events"'))).toBe(true);
    expect(statements.some((query) => query.includes("INSERT INTO organization_structure_revisions"))).toBe(true);
    expect(statements.some((query) => query.includes('insert into "event_outbox"'))).toBe(true);
    expect(statements.at(-1)).toBe("commit");
  });

  it("rolls organization changes back when the event cannot be retained", async () => {
    outboxFails = true;
    await expect(service.save(user, schoolId, input())).rejects.toThrow(/Outbox unavailable/);
    expect(statements.at(-1)).toBe("rollback");
  });

  it("replays an exact save without another effect and rejects an altered retry", async () => {
    const body = input();
    const { createHash } = await import("node:crypto");
    replay = {
      revision: 1,
      nodes: body.nodes,
      request_hash: createHash("sha256")
        .update(JSON.stringify(saveOrganizationSchema.parse(body)))
        .digest("hex"),
    };
    await expect(service.save(user, schoolId, body)).resolves.toMatchObject({
      revision: 1,
      replayed: true,
    });
    expect(statements.some((query) => query.includes("DELETE FROM organization_nodes"))).toBe(false);
    await expect(service.save(user, schoolId, { ...body, nodes: [] })).rejects.toThrow(/different changes/);
  });
});
