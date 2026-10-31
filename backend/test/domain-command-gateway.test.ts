import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL(
  "../migrations/130_domain_command_gateway.sql",
  import.meta.url,
), "utf8");
const core = readFileSync(new URL(
  "../src/campus-model-core/campus-model-core.service.ts",
  import.meta.url,
), "utf8");
const moduleSource = readFileSync(new URL(
  "../src/campus-model-core/campus-model-core.module.ts",
  import.meta.url,
), "utf8");
const staff = readFileSync(new URL(
  "../src/staff-operations/staff-operations.service.ts",
  import.meta.url,
), "utf8");
const attendance = readFileSync(new URL(
  "../src/school/school.service.ts",
  import.meta.url,
), "utf8");
const participation = readFileSync(new URL(
  "../src/attendance/activity-attendance.service.ts", import.meta.url,
), "utf8");

describe("domain command gateway", () => {
  it("retains an immutable handler and request envelope", () => {
    expect(migration).toContain("request_hash char(64)");
    expect(migration).toContain("handler_key varchar(120)");
    expect(migration).toContain("configuration_refs jsonb");
    expect(migration).toContain("A retained domain command envelope is immutable");
  });

  it("distinguishes uncertain execution from rejection and failure", () => {
    expect(migration).toContain("'failed','uncertain','cancelled'");
    expect(core).toContain('"failed", "uncertain", "cancelled"');
  });

  it("binds the command to the server-selected realm and environment", () => {
    expect(core).toContain("const scope = await this.resolveScope(transaction, input.school_id)");
    expect(core).toContain("command.environment_namespace_id=${scope.environment_namespace_id}");
  });

  it("resolves the acting human and obtains a current authority receipt before execution", () => {
    expect(core).toContain("this.resolveAccountEndpointIn(");
    expect(core).toContain("const authority = input.authority_attestation");
    expect(core).toContain("this.retainDomainAuthorityAttestation(transaction");
    expect(core).toContain(": await this.evaluateAuthority(transaction");
    expect(core).toContain('authority.decision !== "allowed"');
  });

  it("uses a request hash and advisory lock for replay-safe effects", () => {
    expect(core).toContain("domain-command:${scope.realm_id}");
    expect(core).toContain("existing.request_hash !== requestHash");
    expect(core).toContain('status: "completed"');
  });

  it("publishes the gateway and routes staff-leave decisions through it", () => {
    expect(moduleSource).toContain("provide: DOMAIN_COMMAND_GATEWAY_PORT");
    expect(moduleSource).toContain("    DOMAIN_COMMAND_GATEWAY_PORT,");
    expect(staff).toContain("this.commandGateway.prepareDomainCommand");
    expect(staff).toContain("this.commandGateway.completeDomainCommand");
    expect(staff).toContain('capability: "staff_leave:decide"');
  });

  it("routes attendance recording through the same gateway without moving Attendance invariants", () => {
    const attendanceWrite = attendance.slice(attendance.indexOf("private async saveAttendanceRecords"), attendance.indexOf("private async attendanceCaptureResult"));
    expect(attendanceWrite).toContain("this.saveTeacherAttendanceInTransaction");
    expect(attendanceWrite).not.toContain("sharedReady");
    expect(attendance).not.toContain("this.commandGateway");
    expect(participation).toContain("this.commands.prepareDomainCommand");
    expect(participation).toContain("this.commands.completeDomainCommand");
    expect(participation).toContain('"attendance:record"');
    const mutation = participation.slice(participation.indexOf("private async mutate("));
    expect(mutation.indexOf("register.revision !== input.expected_revision"))
      .toBeGreaterThanOrEqual(0);
    expect(mutation.indexOf("register.revision !== input.expected_revision"))
      .toBeLessThan(mutation.indexOf("this.commands.prepareDomainCommand"));
  });
});
