import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import type { DatabaseService } from "../src/database/database.service.js";
import { LearningOfferingsService } from "../src/learning/learning-offerings.service.js";
import { LearningElectiveChangeService } from "../src/learning/learning-elective-change.service.js";
import { LearningElectiveModelService } from "../src/learning/learning-elective-model.service.js";
import { FinanceArrangementsAccess } from "../src/operations/finance-arrangements.access.js";
import { ElectiveFinanceReviewService } from "../src/operations/elective-finance-review.service.js";
import { AcademicCatalogueModelService } from "../src/operations/academic-catalogue-model.service.js";
import { FeeLedgerService } from "../src/operations/fee-ledger.service.js";
import { OperationsService } from "../src/operations/operations.service.js";
import { createLearningOfferingFixture, learningOfferingServices } from "./learning-offerings.test-support.js";
import { CoordinationConfigurationService } from "../src/campus-model-core/coordination-configuration.service.js";
import { ActivityPlanningService } from "../src/schedule-planning/activity-planning.service.js";
import { ResponsibilityProjectionService } from "../src/campus-model-core/responsibility-projection.service.js";

export function electiveServices(db: DatabaseService) {
  const base = learningOfferingServices(db), planning = new ActivityPlanningService(db, base.events, base.core, base.core, base.core, new ResponsibilityProjectionService(base.core), base.core);
  const offerings = new LearningOfferingsService(db, base.context, base.model, planning, base.core);
  const access = new FinanceArrangementsAccess(base.core, {} as never), finance = new ElectiveFinanceReviewService(access, base.core);
  const model = new LearningElectiveModelService(base.core, base.core, new CoordinationConfigurationService(base.core), base.core, base.core);
  const service = new LearningElectiveChangeService(db, base.context, offerings, finance, model);
  const catalogue = new AcademicCatalogueModelService(base.core, base.core, base.core, base.core);
  const operations = new OperationsService(db, {} as never, undefined, undefined, undefined, catalogue);
  const ledger = new FeeLedgerService(db, base.core, base.core, base.core, base.core);
  return { ...base, planning, offerings, access, finance, electiveModel: model, service, operations, ledger };
}
export async function createElectiveFixture(db: DatabaseService) {
  const f = await createLearningOfferingFixture(db), s = electiveServices(db);
  const date = (days: number) => new Date(Date.parse(`${f.today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const termId = randomUUID();
  await s.operations.saveCatalog(f.owner, f.schoolId, "terms", { catalog_id: termId, command_id: randomUUID(), name: "Semester I",
    academic_year: `${f.today.slice(0, 4)}-${String(Number(f.today.slice(0, 4)) + 1).slice(-2)}`, starts_on: date(-30), ends_on: date(120), attendance_threshold: 85, is_active: true });
  const create = async (name: string, includeLearner: boolean) => {
    const subjectId = randomUUID();
    await s.operations.saveCatalog(f.owner, f.schoolId, "subjects", { catalog_id: subjectId, command_id: randomUUID(), code: `E${subjectId.replaceAll("-", "").slice(0, 8)}`.toUpperCase(), name,
      short_name: name.slice(0, 20), color: "#2563EB", icon: "book-open" });
    const input = { offering_id: randomUUID(), command_id: randomUUID(), name, instructor: f.reference(f.instructor.person), participants: includeLearner ? [f.reference(f.learner.person), f.reference(f.secondLearner.person)] : [f.reference(f.secondLearner.person)],
      starts_on: f.today, academic_context: { term_id: termId, subject_id: subjectId, course_code: `E${subjectId.slice(0, 7)}`, credits: 4, programme_key: "mtech-data-engineering" } };
    return s.offerings.create(f.owner, input);
  };
  const source = await create("Distributed Data Systems", true), destination = await create("Statistical Learning", false), parallel = await create("Research Methods", true);
  const options = await s.service.options(f.owner, source.id, f.learner.id);
  const selection = { person: { id: options.person.id, expected_revision: options.person.revision }, source_offering: { id: source.id, expected_revision: options.source_offering.revision },
    source_enrollment: { id: options.source_enrollment.id, expected_revision: options.source_enrollment.revision }, destination_offering: { id: destination.id, expected_revision: 1 }, effective_on: date(7) };
  const preview = await s.service.preview(f.owner, { selection });
  const input = (named = true) => ({ change_id: randomUUID(), command_id: randomUUID(), expected_revision: 0 as const, selection, preview_fingerprint: preview.fingerprint,
    reason: "Learner requested the approved Statistics elective instead.", catch_up: { kind: "not_needed" as const, reason: "No destination teaching has been missed; the destination instructor's introductory material remains available." },
    finance_reviewer: named ? { user_id: options.finance_reviewers[0]!.user_id, eligibility_hash: options.finance_reviewers[0]!.eligibility_hash } : null, confirm_delivery: named });
  const classify = async (id: string, outcome: "no_financial_change" | "requires_financial_review" = "no_financial_change") => {
    const workspace = await s.service.financeWorkspace(f.owner, f.schoolId, id);
    const body = { command_id: randomUUID(), expected_revision: workspace.revision, expected_ledger_basis_hash: workspace.ledger_basis_hash, outcome,
      reason: outcome === "no_financial_change" ? "Reviewed this person's exact current account and course basis; no financial adjustment is required." : "Current account needs reconciliation through the existing Finance owner before this course change can proceed." };
    return { body, result: await s.service.classify(f.owner, f.schoolId, id, body) };
  };
  const counts = async () => (await sql<{ invoices: number; payments: number; refunds: number }>`SELECT
    (SELECT count(*)::int FROM fee_invoices WHERE school_id=${f.schoolId}::uuid) AS invoices,
    (SELECT count(*)::int FROM fee_payments WHERE school_id=${f.schoolId}::uuid) AS payments,
    (SELECT count(*)::int FROM fee_refunds WHERE school_id=${f.schoolId}::uuid) AS refunds`.execute(db)).rows[0]!;
  return { ...f, ...s, date, source, destination, parallel, options, selection, preview, input, classify, counts };
}
