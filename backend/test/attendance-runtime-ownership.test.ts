import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("one current attendance writer", () => {
  it("does not retain a pre-cutover mutation engine behind a schema-readiness fallback", async () => {
    const source = await readFile(new URL("../src/attendance-model/attendance-model.service.ts",import.meta.url),"utf8");
    expect(source).not.toMatch(/sharedReady|sharedAttendanceReady|legacySelfCheckIn|legacyDecideEvidence|recordModelCommand|to_regclass|OBSERVATION_INGRESS_PORT|CAMPUS_MODEL_CORE_PORT|recordAttendanceModelObservations/u);
    for (const delegate of ["this.academic.saveSessionRecordsInTransaction", "this.academic.prepareSessionInTransaction",
      "this.academic.prepareSessionForParticipantInTransaction", "this.participation.transition", "this.participation.selfCheckInInTransaction",
      "this.participation.decideEvidence", "recordAcceptedEvent"]) expect(source).toContain(delegate);
    for (const port of ["DOMAIN_COMMAND_GATEWAY_PORT", "DOMAIN_EVENT_JOURNAL_PORT"]) expect(source).toContain(port);
    const module = await readFile(new URL("../src/attendance-model/attendance-model.module.ts",import.meta.url),"utf8");
    for (const dependency of ["SchoolModule", "CampusModelCoreModule", "ActivityAttendanceKernelModule"]) expect(module).toContain(dependency);
    expect(source).not.toContain("@Optional()");
    // Session source/FK materialization and short-lived QR sources remain valid;
    // neither can decide participation outside the shared kernel.
    expect(source).toContain("INSERT INTO attendance_session_registers");
    expect(source).toContain("INSERT INTO attendance_qr_challenges");
  });

  it("keeps compatibility decision/evidence views and archived operating history read-only in active adapters/workers", async () => {
    const names = "(?:attendance_records|attendance_submissions|attendance_record_revisions|attendance_session_entries|attendance_session_submissions|attendance_session_entry_revisions|attendance_session_evidence)(?:_legacy_source)?";
    const sqlWrite = new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+(?:public\\.)?${names}\\b`,"iu");
    const builderWrite = new RegExp(`\\b(?:insertInto|updateTable|deleteFrom)\\(["']${names}["']\\)`,"u");
    for (const path of ["attendance-model/attendance-model.service.ts", "school/school.service.ts", "school/school-event.service.ts"]) {
      const source = await readFile(new URL(`../src/${path}`,import.meta.url),"utf8");
      expect(source.match(sqlWrite),path).toBeNull();
      expect(source.match(builderWrite),path).toBeNull();
    }
  });

  it("keeps prepared-command persistence behind the Core verification port",async()=>{
    const source=await readFile(new URL('../src/attendance/academic-enrollment-roster.source.ts',import.meta.url),'utf8');
    expect(source).toContain('verifyPreparedDomainCommand');
    // The complete SQL/query-builder boundary scanner lives in
    // campus-model-core-persistence-boundary.test.ts and includes this source.
  });

  it("stores source bindings, academic identity and presentation receipts only on their canonical owning rows",async()=>{
    const projection="(?:activity_attendance_source_contexts|activity_attendance_academic_roster|activity_attendance_context_receipts)";
    const write=new RegExp(`\\b(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${projection}\\b`,"iu");
    for(const path of ["attendance/academic-participation-bridge.service.ts","attendance/owned-participation-bridge.service.ts",
      "attendance/activity-attendance.service.ts"]) {
      const source=await readFile(new URL(`../src/${path}`,import.meta.url),"utf8");
      expect(source.match(write),path).toBeNull();
      expect(source).not.toMatch(/activity_attendance_legacy_(?:links|people|command_results)/u);
    }
    const academic=await readFile(new URL("../src/attendance/academic-participation-bridge.service.ts",import.meta.url),"utf8");
    expect(academic).toContain("UPDATE activity_attendance_commands SET context_source_kind=");
    expect(academic).toContain("AND context_source_kind IS NULL RETURNING id");
    const migration=await readFile(new URL("../migrations/214_attendance_storage_convergence.sql",import.meta.url),"utf8");
    expect(migration.match(/DROP TABLE retiring_214_/gu)).toHaveLength(3);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|CONSTRAINT)\s+[a-z_]*_legacy_source|DROP\s+.*\s+CASCADE\s*;/iu);
    expect(migration).not.toContain("CREATE TABLE activity_attendance_retained_sources");
  });
});
