import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Reviewed logic/source contracts only. A new test is ALWAYS in the complete
// suite; it is not promoted to the no-database fast lane by a filename suffix.
export const FAST_TEST_FILES = [
  "account-email-readiness.test.ts",
  "account-mail-queue.test.ts",
  "auth-mfa-reset.test.ts",
  "activity-attendance-history.test.ts",
  "activity-attendance-queue.test.ts",
  "activity-attendance.test.ts",
  "activation-operations-convergence.test.ts",
  "agent-charts.test.ts",
  "agent-contracts.test.ts",
  "analytics-metrics.test.ts",
  "assessment-report-events.test.ts",
  "assessment-result-input.test.ts",
  "assignments-goal-catalogue.test.ts",
  "attendance-model-convergence.test.ts",
  "attendance-runtime-ownership.test.ts",
  "authority-local-date.test.ts",
  "calendar-ical.test.ts",
  "canonical-assessment-event-links.test.ts",
  "canonical-calendar-links.test.ts",
  "canonical-departure-links.test.ts",
  "canonical-message-links.test.ts",
  "canonical-responsibility-workspace-links.test.ts",
  "campus-model-core-persistence-boundary.test.ts",
  "current-account-endpoint-projection.test.ts",
  "campus-scenario-rate-limit.test.ts",
  "campus-scenes.contracts.test.ts",
  "campus-scenes.model.test.ts",
  "campus-scenes-realtime.test.ts",
  "chat-directory-cursor.test.ts",
  "chat-message-cursor.test.ts",
  "database-schema-catalogue-audit.test.ts",
  "database-pool-telemetry.test.ts",
  "database-query-metrics.test.ts",
  "database-unavailable-response.test.ts",
  "directory-import.test.ts",
  "elective-work-source.test.ts",
  "execution-clock.test.ts",
  "fee-authority.test.ts",
  "fees-first-readiness.test.ts",
  "finance-arrangements.test.ts",
  "gate-rules.test.ts",
  "http-api.test-support.test.ts",
  "identity-consumer-boundary.test.ts",
  "import-csv.test.ts",
  "invitation-code.test.ts",
  "invitation-email.test.ts",
  "journey-rules.test.ts",
  "learning-assignment-headers.test.ts",
  "learning-offering-contracts.test.ts",
  "native-fee-reviews.test.ts",
  "operating-day.test.ts",
  "operating-resume.test.ts",
  "participant-name-check.test.ts",
  "payment-receipt.test.ts",
  "people-import-scope.test.ts",
  "progressive-goal-destination.test.ts",
  "progressive-setup.contracts.test.ts",
  "public-live-account-control.test.ts",
  "razorpay-config.test.ts",
  "scoped-role-policy.test.ts",
  "simulation-behaviour-policy.test.ts",
  "simulation-draft-change-description.test.ts",
  "simulation-metrics.test.ts",
  "simulation-sql.test.ts",
  "test-database.test.ts",
  "test-projects.test.ts",
  "typed-notification-producer-links.test.ts",
  "unified-activity-planning.test.ts",
  "visit-onboarding-identity.test.ts",
  "workspace-manifest.test.ts",
  // These validate migration text/structure; actual upgrades remain in full.
  "assessment-report-realtime.migration.test.ts",
  "attendance-continuity.migration.test.ts",
  "calendar-attention-revision.migration.test.ts",
  "campus-event-finance-ledger.migration.test.ts",
  "campus-event-finance-realtime.migration.test.ts",
  "campus-model-gate-observations.migration.test.ts",
  "campus-model-temporal-runtime.migration.test.ts",
  "chat-attention.migration.test.ts",
  "chat-current-scope-authorization.migration.test.ts",
  "departure-coordination.migration.test.ts",
  "feedback-governance-realtime.migration.test.ts",
  "notice-current-scope-authorization.migration.test.ts",
  "role-duty-planning.migration.test.ts",
  "simulation-control-plane.migration.test.ts",
  "timetable-curriculum-ownership.migration.test.ts",
  "transport-duty-planning.migration.test.ts",
  "work-profile-access.migration.test.ts",
  "work-type-origin-integrity.migration.test.ts",
  "work-types-direct-access.migration.test.ts",
  "responsibility-workspace.migration.test.ts",
].map((name) => `test/${name}`);

export function discoverTestFiles(root: string): string[] {
  function visit(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return visit(path);
      return entry.isFile() && entry.name.endsWith(".test.ts")
        ? [relative(root, path).replaceAll("\\", "/")] : [];
    });
  }
  return visit(join(root, "test")).sort();
}

export function partitionTestFiles(all: readonly string[], fast: readonly string[] = FAST_TEST_FILES) {
  if (new Set(fast).size !== fast.length) throw new Error("Duplicate fast-test entry");
  const discovered = new Set(all);
  const missing = fast.filter((file) => !discovered.has(file));
  if (missing.length) throw new Error(`Stale fast-test entries: ${missing.join(", ")}`);
  const selected = new Set(fast);
  return { fast: [...fast], remaining: all.filter((file) => !selected.has(file)) };
}
