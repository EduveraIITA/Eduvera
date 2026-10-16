import { readFileSync } from "node:fs";
import type { Transaction } from "kysely";
import { describe, expect, it } from "vitest";
import type { Database } from "../src/database/types.js";
import { GovernanceService } from "../src/governance/governance.service.js";

const ids = {
  school: "00000000-0000-4000-8000-000000000001",
  owner: "00000000-0000-4000-8000-000000000002",
  otherAdmin: "00000000-0000-4000-8000-000000000003",
  person: "00000000-0000-4000-8000-000000000004",
  office: "00000000-0000-4000-8000-000000000005",
  appointment: "00000000-0000-4000-8000-000000000006",
  rule: "00000000-0000-4000-8000-000000000007",
  sourceA: "00000000-0000-4000-8000-000000000008",
  sourceB: "00000000-0000-4000-8000-000000000009",
  membership: "00000000-0000-4000-8000-000000000010",
};

type RowMap = Record<string, Array<Record<string, unknown>>>;

function transactionWith(rows: RowMap) {
  return {
    selectFrom(table: string) {
      const result = rows[table] ?? [];
      const query = {
        select: () => query,
        selectAll: () => query,
        where: () => query,
        forShare: () => query,
        execute: () => Promise.resolve(result),
        executeTakeFirst: () => Promise.resolve(result[0]),
      };
      return query;
    },
  } as unknown as Transaction<Database>;
}

function authorityRows(): RowMap {
  return {
    schools: [{ id: ids.school, timezone: "Asia/Kolkata" }],
    institution_decision_matter_rules: [{
      id: ids.rule,
      school_id: ids.school,
      code: "staff_leave_decision",
      status: "confirmed",
      decision_mode: "individual",
      decision_office_id: ids.office,
      decision_body_id: null,
      authority_source_ids: [ids.sourceA],
      effective_from: "2026-10-17",
      effective_until: null,
      conditions_summary: "Current officeholder decides within the leave policy.",
      revision: 3,
    }],
    institution_governance_offices: [{
      id: ids.office,
      school_id: ids.school,
      status: "active",
      authority_source_id: ids.sourceA,
      revision: 4,
    }],
    "institution_governance_appointments as appointment": [{
      id: ids.appointment,
      person_id: ids.person,
      linked_user_id: ids.owner,
      starts_on: "2026-10-17",
      ends_on: null,
      status: "active",
      appointment_kind: "appointed",
      authority_source_id: ids.sourceB,
      evidence_reference: "document:APPT-1",
      revision: 5,
    }],
    school_people: [{
      id: ids.person,
      school_id: ids.school,
      revision: 8,
      first_name: "Sensitive",
      last_name: "Officeholder",
      contact_email: "person-private@example.test",
    }],
    users: [{
      id: ids.owner,
      is_active: true,
      email: "account-private@example.test",
      first_name: "Sensitive",
      last_name: "Account",
    }],
    school_memberships: [{ id: ids.membership, user_id: ids.owner, school_id: ids.school, role: "staff", is_active: true }],
    institution_authority_sources: [
      {
        id: ids.sourceA, revision: 6, source_kind: "governing_instrument", reference: "GOV-1",
        provision: "Section 4", evidence_reference: "document:GOV-1", verification_state: "verified",
        effective_from: "2026-04-01", effective_until: null, verified_by: ids.owner,
        verified_at: new Date("2026-04-01T04:00:00.000Z"),
      },
      {
        id: ids.sourceB, revision: 7, source_kind: "appointment_order", reference: "APPT-1",
        provision: "Principal appointment", evidence_reference: "document:APPT-1", verification_state: "self_attested",
        effective_from: "2026-04-01", effective_until: null, verified_by: null, verified_at: null,
      },
    ],
  };
}

function service() {
  return new GovernanceService({} as never, {} as never);
}

describe("governance decision-authority port", () => {
  it("resolves one current officeholder with linked person, user and versioned source evidence", async () => {
    const receipt = await service().resolveDecisionOwner(
      transactionWith(authorityRows()),
      ids.school,
      "staff_leave_decision",
      new Date("2026-10-16T19:00:00.000Z"),
    );

    expect(receipt).toMatchObject({
      school_id: ids.school,
      matter_code: "staff_leave_decision",
      effective_date: "2026-10-17",
      institution_timezone: "Asia/Kolkata",
      decision_mode: "individual",
      user_id: ids.owner,
      account: { id: ids.owner, is_active: true },
      memberships: [{ id: ids.membership, role: "staff", is_active: true }],
      person: { id: ids.person, revision: 8 },
      office: { id: ids.office, revision: 4, status: "active", authority_source_id: ids.sourceA },
      appointment: {
        id: ids.appointment, revision: 5, status: "active", appointment_kind: "appointed",
        starts_on: "2026-10-17", ends_on: null, authority_source_id: ids.sourceB,
        evidence_reference: "document:APPT-1",
      },
      rule: {
        id: ids.rule, revision: 3, status: "confirmed", decision_mode: "individual",
        effective_from: "2026-10-17", effective_until: null,
        conditions_summary: "Current officeholder decides within the leave policy.",
        authority_source_ids: [ids.sourceA],
      },
      sources: [
        expect.objectContaining({
          id: ids.sourceA, revision: 6, source_kind: "governing_instrument", reference: "GOV-1",
          provision: "Section 4", evidence_reference: "document:GOV-1", verification_state: "verified",
          effective_from: "2026-04-01", effective_until: null, verified_by: ids.owner,
          verified_at: "2026-04-01T04:00:00.000Z",
        }),
        expect.objectContaining({
          id: ids.sourceB, revision: 7, source_kind: "appointment_order", reference: "APPT-1",
          provision: "Principal appointment", evidence_reference: "document:APPT-1", verification_state: "self_attested",
          effective_from: "2026-04-01", effective_until: null, verified_by: null, verified_at: null,
        }),
      ],
    });
    expect(JSON.stringify(receipt)).not.toMatch(/Sensitive|private@example\.test/);
    expect(Object.keys(receipt.account).sort()).toEqual(["id", "is_active"]);
    expect(Object.keys(receipt.person).sort()).toEqual(["id", "revision"]);
  });

  it("does not treat technical administrator membership as Principal decision authority", async () => {
    await expect(service().assertDecisionAuthority(
      transactionWith(authorityRows()),
      ids.school,
      "staff_leave_decision",
      ids.otherAdmin,
      new Date("2026-10-17T06:00:00.000Z"),
    )).rejects.toThrow(/current officeholder/i);
  });

  it("keeps same-day rules, appointments and authority sources effective through that date", async () => {
    const rows = authorityRows();
    rows.institution_decision_matter_rules![0]!.effective_until = "2026-10-17";
    rows["institution_governance_appointments as appointment"]![0]!.ends_on = "2026-10-17";
    for (const source of rows.institution_authority_sources!) {
      source.effective_from = "2026-10-17";
      source.effective_until = "2026-10-17";
    }

    await expect(service().resolveDecisionOwner(
      transactionWith(rows),
      ids.school,
      "staff_leave_decision",
      new Date("2026-10-17T06:00:00.000Z"),
    )).resolves.toMatchObject({ effective_date: "2026-10-17", user_id: ids.owner });
  });

  it("fails closed for missing, collective, ambiguous, expired and unlinked routes", async () => {
    const cases: Array<{ label: string; change: (rows: RowMap) => void; message: RegExp }> = [
      {
        label: "missing",
        change: (rows) => { rows.institution_decision_matter_rules = []; },
        message: /no confirmed decision route/i,
      },
      {
        label: "collective",
        change: (rows) => {
          Object.assign(rows.institution_decision_matter_rules![0]!, {
            decision_mode: "collective",
            decision_office_id: null,
            decision_body_id: "00000000-0000-4000-8000-000000000011",
          });
        },
        message: /individual or delegated decision owner/i,
      },
      {
        label: "ambiguous",
        change: (rows) => {
          rows["institution_governance_appointments as appointment"]!.push({
            ...rows["institution_governance_appointments as appointment"]![0]!,
            id: "00000000-0000-4000-8000-000000000012",
          });
        },
        message: /ambiguous effective officeholders/i,
      },
      {
        label: "expired",
        change: (rows) => {
          rows.institution_decision_matter_rules![0]!.effective_until = "2026-10-16";
        },
        message: /no confirmed decision route/i,
      },
      {
        label: "unscheduled",
        change: (rows) => {
          rows.institution_decision_matter_rules![0]!.effective_from = null;
        },
        message: /no confirmed decision route/i,
      },
      {
        label: "unlinked",
        change: (rows) => {
          rows["institution_governance_appointments as appointment"]![0]!.linked_user_id = null;
        },
        message: /not linked to one active institution account/i,
      },
    ];

    for (const testCase of cases) {
      const rows = authorityRows();
      testCase.change(rows);
      await expect(service().resolveDecisionOwner(
        transactionWith(rows),
        ids.school,
        "staff_leave_decision",
        new Date("2026-10-17T06:00:00.000Z"),
      ), testCase.label).rejects.toThrow(testCase.message);
    }
  });

  it("fails closed when authority evidence is unconfirmed or expired", async () => {
    for (const change of [
      (rows: RowMap) => { rows.institution_authority_sources![0]!.verification_state = "recorded"; },
      (rows: RowMap) => { rows.institution_authority_sources![0]!.effective_from = null; },
      (rows: RowMap) => { rows.institution_authority_sources![1]!.effective_until = "2026-10-16"; },
    ]) {
      const rows = authorityRows();
      change(rows);
      await expect(service().resolveDecisionOwner(
        transactionWith(rows),
        ids.school,
        "staff_leave_decision",
        new Date("2026-10-17T06:00:00.000Z"),
      )).rejects.toThrow(/missing, unconfirmed or expired authority evidence/i);
    }
  });

  it("exports the narrow authority token with useExisting and installs no default route", () => {
    const moduleSource = readFileSync(new URL("../src/governance/governance.module.ts", import.meta.url), "utf8");
    const seedSource = readFileSync(new URL("../src/database/seed-governance-authority.ts", import.meta.url), "utf8");
    expect(moduleSource).toContain("GOVERNANCE_DECISION_AUTHORITY_PORT");
    expect(moduleSource).toContain("useExisting: GovernanceService");
    expect(moduleSource).toContain("exports: [GOVERNANCE_DECISION_AUTHORITY_PORT]");
    expect(seedSource).not.toContain("staff_leave_decision");
  });
});
