import { randomUUID } from "node:crypto";
import { CampusModelCoreService } from "../src/campus-model-core/campus-model-core.service.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { createLiveExecutionEnvironment } from "../src/campus-model-core/execution-environment.runtime.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import type { DatabaseService } from "../src/database/database.service.js";
import { ExecutionDataPlaneScope } from "../src/database/execution-data-plane.js";
import { GovernanceService } from "../src/governance/governance.service.js";
import { FeeAuthorityService } from "../src/governance/fee-authority.service.js";
import { FinanceArrangementsAccess } from "../src/operations/finance-arrangements.access.js";
import { FinanceArrangementsBridge } from "../src/operations/finance-arrangements.bridge.js";
import { FinanceArrangementCommands } from "../src/operations/finance-arrangements.commands.js";
import { FinanceArrangementsReadService } from "../src/operations/finance-arrangements.read.js";
import { FinanceArrangementsService } from "../src/operations/finance-arrangements.service.js";
import { SchoolEventService } from "../src/school/school-event.service.js";
import { createClassPracticeFixture } from "./class-practice.test-support.js";
import { createFeeAuthorityMandateFixture } from "./fee-authority.test-support.js";

export function financeArrangementServices(db: DatabaseService) {
  const core = new CampusModelCoreService(db, new ExecutionDataPlaneScope()), events = new SchoolEventService(db, core);
  const governance = new GovernanceService(db, events, core), access = new FinanceArrangementsAccess(core, governance);
  const bridge = new FinanceArrangementsBridge(core, core), commands = new FinanceArrangementCommands(core, core);
  return { core, governance, access, bridge, commands, authority: new FeeAuthorityService(db, core, core, core, governance, new CoordinationConfigurationService(core), core),
    arrangements: new FinanceArrangementsService(db, access, commands, bridge), reads: new FinanceArrangementsReadService(db, access, bridge, commands) };
}
export async function createFinanceArrangementsFixture(db: DatabaseService, options: { maxAmountInr?: number; adopt?: boolean; invoiceDueDays?: number } = {}) {
  const people = await createClassPracticeFixture(db), context = financeArrangementServices(db);
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const environment = createLiveExecutionEnvironment({ institution_id: people.schoolId, clock: { now: () => new Date(now), nowIso: () => now } });
  const run = <T>(action: () => Promise<T>) => executionEnvironmentStorage.run(environment, action);
  const mandate = await run(() => createFeeAuthorityMandateFixture(db, context.core, people.schoolId, people.owner,
    options.maxAmountInr ? { max_amount_inr: options.maxAmountInr } : {}));
  if (options.adopt !== false) await run(async () => {
    const candidate = (await context.authority.workspace(people.owner, people.schoolId)).candidates.find(row => row.mandate_id === mandate.mandateId);
    if (!candidate) throw new Error("The explicit synthetic Finance mandate must be confirmable.");
    await context.authority.confirm(people.owner, people.schoolId, { command_id: randomUUID(), mandate_id: mandate.mandateId, expected: candidate.expected, attestation: true });
  });
  const due = (days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const invoice = await db.insertInto("fee_invoices").values({ school_id: people.schoolId, student_id: people.learner.id, reference: `F-${randomUUID()}`,
    description: "Course and shared resource fees", amount_paise: 3_000_000, due_on: due(options.invoiceDueDays ?? 0), created_by: people.owner.id }).returning("id").executeTakeFirstOrThrow();
  const account = async (actor = people.guardian) => (await context.reads.workspace(actor, people.schoolId, people.learner.id, invoice.id)).invoices[0]!;
  const input = async (overrides: Record<string, unknown> = {}) => {
    const current = await account();
    return { command_id: randomUUID(), request_id: randomUUID(), expected_revision: current.stream_revision, basis_hash: current.basis_hash, basis_revision: current.basis_revision,
      schedule: [{ amount_paise: 1_000_000, due_on: due(1) }, { amount_paise: 2_000_000, due_on: due(30) }], note: "Private payment-plan explanation", ...overrides };
  };
  return { ...people, ...context, ...mandate, invoiceId: invoice.id, now, day, due, environment, run, account, input };
}
