import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationPath = fileURLToPath(new URL("../migrations/019_campus_event_finance_reconciliation.sql", import.meta.url));

describe("campus-event finance reconciliation migration", () => {
  it("defines append-only, tenant-scoped credit, refund and withdrawal ledgers", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("CREATE TABLE campus_event_participant_withdrawals");
    expect(sql).toContain("CREATE TABLE fee_invoice_credits");
    expect(sql).toContain("CREATE TABLE fee_refunds");
    expect(sql).toMatch(/REFERENCES fee_invoices\(school_id,id,student_id\) ON DELETE RESTRICT/g);
    expect(sql).toContain("REFERENCES campus_event_participants(school_id,event_id,student_id,fee_invoice_id)");
    expect(sql).toContain("source IN ('event_cancelled','participant_withdrawn')");
    expect(sql).toContain("request_hash char(64)");
    expect(sql).toContain("prevent_campus_event_finance_ledger_mutation");
    expect(sql).toContain("ALTER TABLE %I ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON TABLE %I FROM PUBLIC");
  });

  it("serializes money changes and derives cancellation credits in-transaction", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("fee_payments_serialize_invoice_before_insert");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("Credits exceed the invoice amount");
    expect(sql).toContain("Refunds exceed credited obligations");
    expect(sql).toContain("Refunds exceed payments received");
    expect(sql).toContain("campus_event_cancelled_finance_reconciliation");
    expect(sql).toContain("append_campus_event_cancellation_credits");
    expect(sql).toContain("campus-event-cancel-credit:");
  });
});
