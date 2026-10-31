import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/password.js";
import type { Database } from "../src/database/types.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { createDiningFixture } from "./dining.test-support.js";
import { IsolatedAppHttp } from "./isolated-app-http.test-support.js";
import { requireIsolatedTestDatabaseUrl } from "./test-database.js";
const enabled = process.env.TEST_DATABASE_ISOLATED === "true",
  source = enabled
    ? requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL)
    : "postgresql://invalid.invalid/dining_http_unused_test";
const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({ connectionString: source, max: 3 }),
  }),
}) as DatabaseService;
const app = new IsolatedAppHttp(),
  command = (expected_revision = 0) => ({
    command_id: randomUUID(),
    expected_revision,
  });
type Result = {
  id: string;
  kind: "service" | "session" | "issue" | "plan";
  series_id?: string;
  revision: number;
};
type Session = {
  id: string;
  revision: number;
  state: string;
  count_total: number | null;
  count_receipt_id: string | null;
  allowed_actions: string[];
  history: Array<{ action: string }>;
};
describe.skipIf(!enabled)(
  "Dining through the ordinary authenticated app",
  () => {
    beforeAll(() => app.start(source), 30000);
    afterAll(async () => {
      await app.stop();
      await db.destroy();
    });
    it("completes native menu/service/count/correction/shortage work without granting operator setup authority", async () => {
      process.env.INVITATION_EMAIL_ENABLED = "false";
      const f = await createDiningFixture(db),
        password = `Fictional-Dining-${randomUUID()}!`;
      await db
        .updateTable("users")
        .set({ password_hash: await hashPassword(password) })
        .where("id", "in", [f.user.id, f.borrower.id])
        .execute();
      const owner = app.session(),
        operator = app.session();
      await owner.login(f.user.email, password, f.schoolId);
      await operator.login(f.borrower.email, password, f.schoolId);
      const base = `/api/v1/schools/${f.schoolId}/dining`;
      expect((await app.session().request(`${base}/workspace`)).status).toBe(
        401,
      );
      const setup = {
        ...command(),
        name: "Fictional walk-in lunch",
        coordinator_person_id: f.custodianPersonId,
      };
      expect(
        (await operator.request(`${base}/services`, "POST", setup)).status,
      ).toBe(403);
      expect(
        (await owner.request(`${base}/services`, "POST", setup, false)).status,
      ).toBe(403);
      const service = await owner.json<Result>(
        `${base}/services`,
        "POST",
        setup,
      );
      expect(await owner.json(`${base}/services`, "POST", setup)).toEqual(
        service,
      );
      const created = await owner.json<Result>(`${base}/sessions`, "POST", {
        ...command(),
        service_id: service.id,
        service_expected_revision: service.revision,
        label: "Lunch",
        operator_person_id: f.borrowerPersonId,
        starts_at: new Date(Date.now() - 60000).toISOString(),
        ends_at: new Date(Date.now() + 3600000).toISOString(),
        menu_text: "Rice and vegetables",
      });
      const path = `${base}/sessions/${created.id}`;
      expect(await operator.json<Session>(path)).toMatchObject({
        state: "draft",
        count_total: null,
      });
      const publish = { ...command(created.revision), action: "publish" };
      let result = await owner.json<Result>(`${path}/actions`, "POST", publish);
      expect(await owner.json(`${path}/actions`, "POST", publish)).toEqual(
        result,
      );
      expect(
        await owner.json(
          `${base}/confirmation?source_id=${created.id}&command_id=${publish.command_id}`,
        ),
      ).toMatchObject({ state: "accepted", result });
      expect(
        (
          await owner.request(`${path}/actions`, "POST", {
            ...command(result.revision),
            action: "open",
          })
        ).status,
      ).toBe(403);
      result = await operator.json<Result>(`${path}/actions`, "POST", {
        ...command(result.revision),
        action: "open",
      });
      result = await operator.json<Result>(`${path}/actions`, "POST", {
        ...command(result.revision),
        action: "count",
        count_total: 7,
        observed_at: new Date().toISOString(),
      });
      const count = await operator.json<Session>(path);
      expect(count.count_total).toBe(7);
      result = await operator.json<Result>(`${path}/actions`, "POST", {
        ...command(result.revision),
        action: "correct_count",
        count_total: 6,
        observed_at: new Date().toISOString(),
        supersedes_receipt_id: count.count_receipt_id,
        note: "One portion was counted twice",
      });
      expect((await operator.json<Session>(path)).count_total).toBe(6);
      let issue = await operator.json<Result>(`${path}/issues`, "POST", {
        ...command(result.revision),
        title: "Fictional shortage",
        note: "Two trays need replacing",
        handler_person_id: f.custodianPersonId,
      });
      issue = await owner.json<Result>(
        `${base}/issues/${issue.id}/actions`,
        "POST",
        { ...command(issue.revision), action: "accept" },
      );
      issue = await owner.json<Result>(
        `${base}/issues/${issue.id}/actions`,
        "POST",
        {
          ...command(issue.revision),
          action: "resolve",
          note: "The kitchen supplied the agreed replacement",
        },
      );
      expect(await operator.json(`${base}/issues/${issue.id}`)).toMatchObject({
        state: "resolved",
        history: expect.arrayContaining([
          expect.objectContaining({ action: "resolved" }),
        ]),
      });
      result = await operator.json<Result>(`${path}/actions`, "POST", {
        ...command(result.revision),
        action: "end",
        note: "Lunch counter is closed",
      });
      const ended = await operator.json<Session>(path);
      expect(ended.state).toBe("ended");
      expect(ended.history.map((r) => r.action)).toContain("count_corrected");
      expect(
        (
          await operator.request(`${base}/services`, "POST", {
            ...setup,
            command_id: randomUUID(),
          })
        ).status,
      ).toBe(403);
      await db
        .updateTable("school_memberships")
        .set({ is_active: false })
        .where("school_id", "=", f.schoolId)
        .where("user_id", "=", f.borrower.id)
        .execute();
      expect((await operator.request(path)).status).toBe(403);
    }, 90000);
    it("publishes weekly availability and corrects one authenticated date without rewriting other dates", async () => {
      const f = await createDiningFixture(db),
        password = `Fictional-weekly-${randomUUID()}!`;
      await db
        .updateTable("users")
        .set({ password_hash: await hashPassword(password) })
        .where("id", "in", [f.user.id, f.borrower.id])
        .execute();
      const owner = app.session(),
        operator = app.session();
      await owner.login(f.user.email, password, f.schoolId);
      await operator.login(f.borrower.email, password, f.schoolId);
      const base = `/api/v1/schools/${f.schoolId}/dining`,
        date = new Date().toISOString().slice(0, 10),
        tomorrow = new Date(Date.parse(`${date}T12:00:00Z`) + 86400000)
          .toISOString()
          .slice(0, 10);
      const service = await owner.json<Result>(`${base}/services`, "POST", {
        ...command(),
        name: "Fictional weekly service",
        coordinator_person_id: f.custodianPersonId,
      });
      const body = {
        ...command(),
        service_id: service.id,
        service_expected_revision: service.revision,
        label: "Weekly lunch",
        timezone: "UTC",
        starts_on: date,
        ends_on: null,
        days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          menu_text: "Rice and vegetables",
          starts_at: "12:00",
          ends_at: "13:00",
          end_day_offset: 0,
          space_id: null,
          operator_person_id: f.borrowerPersonId,
          start_fold: "reject",
          end_fold: "reject",
        })),
        note: "",
      };
      expect(
        (await app.session().request(`${base}/plans`, "POST", body)).status,
      ).toBe(401);
      expect(
        (await owner.request(`${base}/plans`, "POST", body, false)).status,
      ).toBe(403);
      expect(
        (await operator.request(`${base}/plans`, "POST", body)).status,
      ).toBe(403);
      const draft = await owner.json<Result>(`${base}/plans`, "POST", body);
      expect(await owner.json(`${base}/plans`, "POST", body)).toEqual(draft);
      const publication = {
        ...command(draft.revision),
        note: "Reviewed weekly menu",
      };
      const published = await owner.json<Result>(
        `${base}/plans/${draft.id}/publish`,
        "POST",
        publication,
      );
      expect(
        await owner.json(
          `${base}/plans/${draft.id}/publish`,
          "POST",
          publication,
        ),
      ).toEqual(published);
      expect(
        await owner.json(
          `${base}/confirmation?source_id=${published.id}&command_id=${publication.command_id}`,
        ),
      ).toMatchObject({ state: "accepted", result: published });
      type DateView = {
        origin: "plan_date";
        id: string;
        plan_version_id: string;
        plan_revision: number;
        menu_text: string;
      };
      const path = `${base}/plans/${published.series_id}/dates/${date}`,
        current = await owner.json<DateView>(path);
      const edit = {
        command_id: randomUUID(),
        expected_plan_version_id: current.plan_version_id,
        expected_plan_revision: current.plan_revision,
        expected_session_revision: 0,
        action: "publish_changes",
        note: "Only this date needs a replacement",
        menu_text: "Festival meal",
      };
      expect(
        (await operator.request(`${path}/actions`, "POST", edit)).status,
      ).toBe(403);
      const edited = await owner.json<Result>(`${path}/actions`, "POST", edit);
      expect(await owner.json(`${path}/actions`, "POST", edit)).toEqual(edited);
      expect(
        await operator.json(`${base}/sessions/${edited.id}`),
      ).toMatchObject({ menu_text: "Festival meal", count_total: null });
      expect(
        await operator.json(
          `${base}/plans/${published.series_id}/dates/${tomorrow}`,
        ),
      ).toMatchObject({
        origin: "plan_date",
        menu_text: "Rice and vegetables",
      });
      await owner.json(`${base}/sessions/${edited.id}/actions`, "POST", {
        ...command(edited.revision),
        action: "cancel",
        note: "This date is closed",
      });
      expect(await operator.json(`${path}`)).toMatchObject({
        origin: "session",
        session: { state: "cancelled" },
      });
      expect(
        await operator.json(
          `${base}/plans/${published.series_id}/dates/${tomorrow}`,
        ),
      ).toMatchObject({
        origin: "plan_date",
        menu_text: "Rice and vegetables",
      });
    }, 60000);
  },
);
