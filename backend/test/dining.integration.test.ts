import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createDiningFixture } from "./dining.test-support.js";
import { resourceLoanRequest } from "./resource-loans.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true",
  url = enabled
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://invalid.invalid/dining_unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: url, max: 5 }),
  }),
}) as DatabaseService;
beforeAll(() => {
  process.env.INVITATION_EMAIL_ENABLED = "false";
});
afterAll(() => db.destroy());
type Fixture = Awaited<ReturnType<typeof createDiningFixture>>;
const command = (expected_revision = 0) => ({
  command_id: randomUUID(),
  expected_revision,
});
async function fixture(extra: Record<string, unknown> = {}) {
  const f = await createDiningFixture(db);
  return f.run(async () => {
    const space = await f.topology.createSpace(
      f.user,
      f.schoolId,
      {
        campus_id: f.campusId,
        name: "Fictional dining hall",
        code: `HALL-${randomUUID().slice(0, 6)}`,
        kind: "other",
      },
      resourceLoanRequest(f.user),
    );
    if (typeof space.id !== "string")
      throw new Error("Missing canonical space ID.");
    const service = await f.dining.saveService(f.user, f.schoolId, {
      ...command(),
      name: "Fictional lunch service",
      coordinator_person_id: f.custodianPersonId,
      space_id: space.id,
      ...extra,
    });
    return { ...f, spaceId: space.id, service };
  });
}
const draft = (
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {},
) =>
  f.dining.createSession(f.user, f.schoolId, {
    ...command(),
    service_id: f.service.id,
    service_expected_revision: f.service.revision,
    label: "Lunch",
    operator_person_id: f.borrowerPersonId,
    space_id: f.spaceId,
    starts_at: f.now,
    ends_at: new Date(Date.parse(f.now) + 3600000).toISOString(),
    menu_text: "Rice and vegetables",
    ...extra,
  });
async function detail(f: Fixture, id: string, actor = f.user) {
  const row = await f.dining.detail(actor, f.schoolId, id);
  if (!("count_total" in row))
    throw new Error("Unexpected recovery-only record.");
  return row;
}
describe.skipIf(!enabled)("Native Dining commands, facts and recovery", () => {
  it("accepts explicitly resolved clock-change instants and gives exact stale-parent proof", async () => {
    const f = await fixture();
    await f.run(async () => {
      await db
        .updateTable("schools")
        .set({ timezone: "America/New_York" })
        .where("id", "=", f.schoolId)
        .execute();
      const clockChange = await draft(f, {
        starts_at: "2026-11-01T01:15:00-04:00",
        ends_at: "2026-11-01T01:45:00-05:00",
      });
      const planned = await detail(f, clockChange.id);
      expect(planned.starts_at).toBe("2026-11-01T05:15:00.000Z");
      expect(planned.ends_at).toBe("2026-11-01T06:45:00.000Z");
      await f.dining.saveService(f.user, f.schoolId, {
        ...command(f.service.revision),
        id: f.service.id,
        name: "Lunch service renamed",
        coordinator_person_id: f.custodianPersonId,
        space_id: f.spaceId,
        reason: "Clarify the source name",
      });
      try {
        await draft(f);
        throw new Error("Expected stale parent rejection");
      } catch (error) {
        expect(error).toMatchObject({
          response: {
            code: "dining_obsolete",
            fields: {
              dining_obsolete: {
                source_id: f.service.id,
                expected_revision: 1,
                current_revision: 2,
                receipt_state: "absent",
                confirmation: "permanently_inapplicable",
              },
            },
          },
        });
      }
    });
  });
  it("preserves the canonical campus and human agents through publish/run/cumulative correction/end", async () => {
    const f = await fixture();
    await f.run(async () => {
      const before = await db
        .selectFrom("campus_resource_holdings")
        .select("id")
        .where("school_id", "=", f.schoolId)
        .execute();
      let source = await draft(f);
      expect(await detail(f, source.id)).toMatchObject({
        state: "draft",
        count_total: null,
        venue_reserved: false,
        availability_only: true,
        location_path: expect.arrayContaining([
          expect.objectContaining({ id: f.spaceId }),
        ]),
      });
      const publish = { ...command(source.revision), action: "publish" };
      source = await f.dining.act(f.user, f.schoolId, source.id, publish);
      expect(
        await f.dining.act(f.user, f.schoolId, source.id, publish),
      ).toEqual(source);
      await expect(
        f.dining.act(f.user, f.schoolId, source.id, {
          ...publish,
          note: "changed payload",
        }),
      ).rejects.toThrow(/different/);
      await expect(
        f.dining.act(f.user, f.schoolId, source.id, {
          ...command(source.revision),
          action: "open",
        }),
      ).rejects.toThrow(/not available/);
      source = await f.dining.act(f.borrower, f.schoolId, source.id, {
        ...command(source.revision),
        action: "open",
      });
      source = await f.dining.act(f.borrower, f.schoolId, source.id, {
        ...command(source.revision),
        action: "count",
        count_total: 15,
        observed_at: f.now,
      });
      const counted = await detail(f, source.id, f.borrower);
      expect(counted.count_total).toBe(15);
      source = await f.dining.act(f.borrower, f.schoolId, source.id, {
        ...command(source.revision),
        action: "correct_count",
        count_total: 12,
        observed_at: f.now,
        supersedes_receipt_id: counted.count_receipt_id,
        note: "Three portions were recorded twice",
      });
      expect((await detail(f, source.id)).count_total).toBe(12);
      source = await f.dining.act(f.borrower, f.schoolId, source.id, {
        ...command(source.revision),
        action: "end",
        note: "Counter closed after lunch",
      });
      const ended = await detail(f, source.id);
      expect(ended.state).toBe("ended");
      expect(ended.history).toHaveLength(6);
      const journal = await db
        .selectFrom("campus_model_events")
        .select(["context_entity_id", "actor_agent_id", "payload"])
        .where("school_id", "=", f.schoolId)
        .where("source_domain", "=", "dining")
        .where("source_record_id", "=", source.id)
        .execute();
      expect(journal).toHaveLength(6);
      expect(
        journal.every((e) => e.context_entity_id && e.actor_agent_id),
      ).toBe(true);
      expect(JSON.stringify(journal)).not.toContain("Rice and vegetables");
      const canonicalPlace = await db
        .selectFrom("campus_model_entities")
        .select(["kind", "source_revision", "metadata"])
        .where("school_id", "=", f.schoolId)
        .where("domain", "=", "campus_topology")
        .where("domain_id", "=", f.spaceId)
        .executeTakeFirstOrThrow();
      expect(canonicalPlace).toMatchObject({
        kind: "space",
        source_revision: 1,
        metadata: { space_kind: "other" },
      });
      expect(
        await db
          .selectFrom("campus_resource_holdings")
          .select("id")
          .where("school_id", "=", f.schoolId)
          .execute(),
      ).toEqual(before);
      expect((await f.dining.work(f.borrower, f.schoolId)).needs_me).toEqual(
        [],
      );
    });
  });
  it("pins immutable menu publication and permits only explicit reasoned visible changes", async () => {
    const f = await fixture();
    await f.run(async () => {
      let source = await draft(f);
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "publish",
      });
      await expect(
        f.dining.act(f.user, f.schoolId, source.id, {
          ...command(source.revision),
          action: "save",
          menu_text: "Unreviewed replacement",
        }),
      ).rejects.toThrow(/not available/);
      await expect(
        f.dining.act(f.user, f.schoolId, source.id, {
          ...command(source.revision),
          action: "publish_changes",
          menu_text: "Replacement",
        }),
      ).rejects.toThrow(/reason/);
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "publish_changes",
        menu_text: "Flatbread and vegetables",
        note: "Rice unavailable; publish the agreed substitution",
      });
      const current = await detail(f, source.id);
      expect(current.menu_text).toBe("Flatbread and vegetables");
      expect(
        current.history.some((h) => h.menu_text === "Rice and vegetables"),
      ).toBe(true);
      await expect(
        db
          .updateTable("dining_session_receipts")
          .set({ menu_text: "Rewritten history" })
          .where("school_id", "=", f.schoolId)
          .where("session_id", "=", source.id)
          .execute(),
      ).rejects.toThrow(/immutable/);
      await expect(
        db
          .updateTable("dining_sessions")
          .set({
            menu_text: "No native receipt",
            revision: source.revision + 1,
          })
          .where("school_id", "=", f.schoolId)
          .where("id", "=", source.id)
          .execute(),
      ).rejects.toThrow(/immutable native revision/);
    });
  });
  it("serializes competing counts, exact retries and corrections without adding cumulative totals", async () => {
    const f = await fixture();
    await f.run(async () => {
      let source = await draft(f);
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "publish",
      });
      source = await f.dining.act(f.borrower, f.schoolId, source.id, {
        ...command(source.revision),
        action: "open",
      });
      const attempts = await Promise.allSettled(
        [20, 25].map((count_total) =>
          f.dining.act(f.borrower, f.schoolId, source.id, {
            ...command(source.revision),
            action: "count",
            count_total,
            observed_at: f.now,
          }),
        ),
      );
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const current = await detail(f, source.id);
      expect([20, 25]).toContain(current.count_total);
      expect(current.revision).toBe(4);
      await expect(
        f.dining.act(f.borrower, f.schoolId, source.id, {
          ...command(current.revision),
          action: "count",
          count_total: 1,
          observed_at: f.now,
        }),
      ).rejects.toThrow(/Correct count/);
      await expect(
        f.dining.act(f.borrower, f.schoolId, source.id, {
          ...command(current.revision),
          action: "correct_count",
          count_total: 1,
          observed_at: f.now,
          supersedes_receipt_id: randomUUID(),
          note: "Wrong previous reference",
        }),
      ).rejects.toThrow(/latest count/);
      expect(
        await f.dining.confirmation(
          f.borrower,
          f.schoolId,
          source.id,
          randomUUID(),
        ),
      ).toEqual({ state: "not_found", result: null });
    });
  });
  it("uses explicit exact-source shortage handling, private evidence and same-report reopening", async () => {
    const f = await fixture();
    await f.run(async () => {
      let source = await draft(f);
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "publish",
      });
      let issue = await f.dining.reportIssue(
        f.borrower,
        f.schoolId,
        source.id,
        {
          ...command(source.revision),
          title: "Fictional rice shortage",
          note: "Private operational explanation",
          handler_person_id: f.custodianPersonId,
        },
      );
      expect((await f.dining.work(f.user, f.schoolId)).needs_me).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ issue_id: issue.id, action: "resolve" }),
        ]),
      );
      issue = await f.dining.actIssue(f.user, f.schoolId, issue.id, {
        ...command(issue.revision),
        action: "accept",
      });
      issue = await f.dining.actIssue(f.user, f.schoolId, issue.id, {
        ...command(issue.revision),
        action: "resolve",
        note: "Delivered the agreed replacement meal",
      });
      issue = await f.dining.actIssue(f.borrower, f.schoolId, issue.id, {
        ...command(issue.revision),
        action: "reopen",
        note: "The second counter still has no replacement",
      });
      const reviewed = await f.dining.issueDetail(
        f.borrower,
        f.schoolId,
        issue.id,
      );
      expect(reviewed.state).toBe("open");
      if ("history" in reviewed)
        expect(reviewed.history.map((h) => h.action)).toEqual([
          "reopened",
          "resolved",
          "accepted",
          "reported",
        ]);
      expect(
        JSON.stringify(await f.dining.work(f.borrower, f.schoolId)),
      ).not.toContain("Private operational explanation");
    });
  });
  it("supports independent menu/operation ownership without copied provider facts or fake remote actions", async () => {
    for (const modes of [
      { menu_mode: "native", operations_mode: "reference" },
      { menu_mode: "reference", operations_mode: "native" },
      { menu_mode: "reference", operations_mode: "reference" },
    ] as const) {
      const f = await fixture({
        ...modes,
        source_label: "Fictional vendor",
        source_url: "https://vendor.example.test/menu",
        source_reference: "OUTLET-1",
      });
      await f.run(async () => {
        if (
          modes.menu_mode === "reference" &&
          modes.operations_mode === "reference"
        ) {
          await expect(draft(f, { menu_text: "" })).rejects.toThrow(
            /reference-only/,
          );
          return;
        }
        let source = await draft(f, {
          menu_text:
            modes.menu_mode === "native" ? "Campus-published menu" : "",
        });
        source = await f.dining.act(f.user, f.schoolId, source.id, {
          ...command(source.revision),
          action: "publish",
        });
        const row = await detail(f, source.id, f.borrower);
        expect(row.source?.mode).toBe("reference_only");
        if (modes.operations_mode === "reference") {
          expect(row.allowed_actions).not.toContain("open");
          await expect(
            f.dining.act(f.borrower, f.schoolId, source.id, {
              ...command(source.revision),
              action: "open",
            }),
          ).rejects.toThrow(/not available/);
        } else expect(row.allowed_actions).toContain("open");
        if (modes.menu_mode === "reference")
          await expect(
            f.dining.act(f.user, f.schoolId, source.id, {
              ...command(source.revision),
              action: "publish_changes",
              menu_text: "Copied vendor data",
              note: "Invalid ownership",
            }),
          ).rejects.toThrow(/external source/);
      });
    }
  });
  it("rejects foreign canonical IDs, passive workers and secret-bearing reference links", async () => {
    const f = await fixture(),
      other = await fixture();
    await f.run(async () => {
      await expect(draft(f, { space_id: other.spaceId })).rejects.toThrow(
        /active place/,
      );
      await expect(
        draft(f, { operator_person_id: other.borrowerPersonId }),
      ).rejects.toThrow(/current campus app access/);
      await expect(
        f.dining.saveService(f.borrower, f.schoolId, {
          ...command(),
          name: "No institution authority",
          coordinator_person_id: f.borrowerPersonId,
        }),
      ).rejects.toThrow(/authority/);
      for (const source_url of [
        "https://user:password@example.test/menu",
        "https://example.test/menu?api_key=secret",
        "https://example.test/menu#token",
      ])
        await expect(
          f.dining.saveService(f.user, f.schoolId, {
            ...command(),
            name: "Unsafe source",
            coordinator_person_id: f.custodianPersonId,
            menu_mode: "reference",
            source_label: "Vendor",
            source_url,
          }),
        ).rejects.toThrow();
      expect(
        await f.dining.options(f.user, f.schoolId, {
          person_id: f.borrowerPersonId,
        }),
      ).toMatchObject({
        can_create_places: true,
        people: expect.arrayContaining([
          expect.objectContaining({ id: f.borrowerPersonId, has_app: true }),
        ]),
      });
    });
  });
  it("keeps expired assignment routes disabled until an explicit same-person reissue", async () => {
    const f = await fixture();
    await f.run(async () => {
      let source = await draft(f);
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "publish",
      });
      const native = await db
          .selectFrom("dining_sessions")
          .selectAll()
          .where("id", "=", source.id)
          .executeTakeFirstOrThrow(),
        receipt = native.coordination_receipt as { message_id: string };
      await db.transaction().execute((tx) =>
        f.core.recordMessageOutcome(tx, {
          school_id: f.schoolId,
          message_id: receipt.message_id,
          state: "cancelled",
          actor: null,
          source_outbox_event_id: null,
          code: "test_route_cancelled",
          explanation: "Explicit fictional route cancellation",
          response: null,
          occurred_at: f.now,
          idempotency_key: `dining-test:${randomUUID()}`,
        }),
      );
      expect(
        (await detail(f, source.id, f.borrower)).allowed_actions,
      ).not.toContain("open");
      await expect(
        f.dining.act(f.borrower, f.schoolId, source.id, {
          ...command(source.revision),
          action: "open",
        }),
      ).rejects.toThrow();
      source = await f.dining.act(f.user, f.schoolId, source.id, {
        ...command(source.revision),
        action: "reassign",
        operator_person_id: f.borrowerPersonId,
        note: "Reissue the explicitly cancelled handoff",
      });
      expect(
        (await detail(f, source.id, f.borrower)).allowed_actions,
      ).toContain("open");
      await expect(
        f.dining.act(f.user, f.schoolId, source.id, {
          ...command(source.revision),
          action: "reassign",
          operator_person_id: f.borrowerPersonId,
          note: "No actual change",
        }),
      ).rejects.toThrow(/already current/);
    });
  });
  it("keeps exact count pointers and private reports source-qualified even for campus managers", async () => {
    const f = await fixture();
    await f.run(async () => {
      const service = await f.dining.saveService(f.user, f.schoolId, {
        ...command(),
        name: "Separate private operation",
        coordinator_person_id: f.borrowerPersonId,
        space_id: f.spaceId,
      });
      let session = await f.dining.createSession(f.user, f.schoolId, {
        ...command(),
        service_id: service.id,
        service_expected_revision: service.revision,
        label: "Separate lunch",
        operator_person_id: f.borrowerPersonId,
        space_id: f.spaceId,
        starts_at: f.now,
        ends_at: new Date(Date.parse(f.now) + 3600000).toISOString(),
        menu_text: "Vegetable lunch",
      });
      await expect(
        f.dining.detail(f.user, f.schoolId, session.id),
      ).rejects.toThrow(/exact coordinator/);
      session = await f.dining.act(f.borrower, f.schoolId, session.id, {
        ...command(session.revision),
        action: "publish",
      });
      session = await f.dining.act(f.borrower, f.schoolId, session.id, {
        ...command(session.revision),
        action: "open",
      });
      session = await f.dining.act(f.borrower, f.schoolId, session.id, {
        ...command(session.revision),
        action: "count",
        count_total: 0,
        observed_at: f.now,
      });
      const current = await detail(f, session.id, f.borrower);
      expect(current.count_total).toBe(0);
      expect((await detail(f, session.id)).count_total).toBeNull();
      const pointer = (
        await sql<{
          valid: boolean;
        }>`SELECT dining_count_pointer_valid(${f.schoolId}::uuid,${session.id}::uuid,${current.count_receipt_id}::uuid,0,${session.revision}) AS valid`.execute(
          db,
        )
      ).rows[0]!.valid;
      expect(pointer).toBe(true);
      expect(
        (
          await sql<{
            valid: boolean;
          }>`SELECT dining_count_pointer_valid(${f.schoolId}::uuid,${randomUUID()}::uuid,${current.count_receipt_id}::uuid,0,${session.revision}) AS valid`.execute(
            db,
          )
        ).rows[0]!.valid,
      ).toBe(false);
      const issue = await f.dining.reportIssue(
        f.borrower,
        f.schoolId,
        session.id,
        {
          ...command(session.revision),
          title: "Private counter shortage",
          note: "Private provider explanation",
          handler_person_id: f.borrowerPersonId,
        },
      );
      await expect(
        f.dining.issueDetail(f.user, f.schoolId, issue.id),
      ).rejects.toThrow(/private/);
      expect(
        (await f.dining.work(f.user, f.schoolId)).needs_me.some(
          (row) => row.issue_id === issue.id,
        ),
      ).toBe(false);
    });
  });
});
