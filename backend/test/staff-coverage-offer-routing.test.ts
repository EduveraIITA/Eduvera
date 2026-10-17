import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { staffCoverageOfferBehaviourSchema } from "../src/staff-operations/staff-coverage-offer-bridge.service.js";

const migration = readFileSync(
  resolve(process.cwd(), "migrations/116_staff_coverage_configured_offer_routing.sql"),
  "utf8",
);
const bridge = readFileSync(
  resolve(process.cwd(), "src/staff-operations/staff-coverage-offer-bridge.service.ts"),
  "utf8",
);
const reconciliation = readFileSync(
  resolve(process.cwd(), "src/staff-operations/staff-coverage-reconciliation.service.ts"),
  "utf8",
);
const operations = readFileSync(
  resolve(process.cwd(), "src/staff-operations/staff-operations.service.ts"),
  "utf8",
);
const core = readFileSync(
  resolve(process.cwd(), "src/campus-model-core/campus-model-core.service.ts"),
  "utf8",
);

describe("configured first staff-coverage Offer routing", () => {
  it("requires every mutable selection and terminal-disposition choice in approved configuration", () => {
    const configuration = {
      workflow: "staff_coverage_offer_routing",
      candidate_strategy: "least_recently_accepted",
      candidate_pool: { staff_kind: "teaching", department_scope: "same_as_absent" },
      outcomes: {
        no_eligible_candidate: "manual_review",
        declined: "manual_review",
        expired: "manual_review",
      },
      manual_override: "allowed",
    };
    expect(staffCoverageOfferBehaviourSchema.parse(configuration)).toEqual(configuration);
    expect(staffCoverageOfferBehaviourSchema.safeParse({
      ...configuration,
      candidate_strategy: undefined,
    }).success).toBe(false);
    expect(staffCoverageOfferBehaviourSchema.safeParse({
      ...configuration,
      outcomes: { no_eligible_candidate: "manual_review" },
    }).success).toBe(false);
    expect(staffCoverageOfferBehaviourSchema.safeParse({
      ...configuration,
      fallback_teacher_id: "hidden-default",
    }).success).toBe(false);
  });

  it("retains an immutable tenant-bound exact route and message binding", () => {
    expect(migration).toContain("CREATE TABLE public.staff_coverage_offer_routes");
    expect(migration).toContain("UNIQUE(school_id,coverage_task_id,source_task_revision)");
    expect(migration).toContain("staff_coverage_offer_routes_current_offer_idx");
    expect(migration).toContain("REFERENCES public.campus_model_behaviour_versions(id,school_id)");
    expect(migration).toContain("REFERENCES public.campus_model_event_subscriptions(id,behaviour_version_id,school_id)");
    expect(migration).toContain("REFERENCES public.campus_model_operational_messages(id,school_id)");
    expect(migration).toContain("Coverage offer route evidence is immutable");
    expect(migration).toContain("Coverage offer route history is append-only");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("selects only active available staff in a stable explainable order through the Core port", () => {
    expect(bridge).toContain("profile.status='active'");
    expect(bridge).toContain("membership.role='staff' AND membership.is_active");
    expect(bridge).toContain("leave_request.status='approved'");
    expect(bridge).toContain("effective_school_schedule(");
    expect(bridge).toContain("cover.status IN ('offered','accepted')");
    expect(bridge).toContain("left.staff_code.localeCompare(right.staff_code");
    expect(bridge).toContain("left.profile_id.localeCompare(right.profile_id)");
    expect(bridge).toContain("this.coordination.resolveEventRoute");
    expect(bridge).toContain("this.coordination.authorizeCandidateRecipients");
    expect(bridge).not.toMatch(/(?:FROM|JOIN|INSERT INTO|UPDATE)\s+campus_model_/i);
  });

  it("publishes exactly the configured Offer and binds response to its recipient, revision and deadline", () => {
    expect(bridge).toContain('route.message_kind !== "offer"');
    expect(bridge).toContain("route.selector.min_recipients !== 1");
    expect(bridge).toContain("route.selector.max_recipients !== 1");
    expect(bridge).toContain("expected_route:");
    expect(bridge).toContain("message_id=${input.binding.message_id}");
    expect(bridge).toContain("offered_task_revision=${input.task_revision}");
    expect(bridge).toContain("if (route.length === 0) return null");
    expect(bridge).toContain("AND status='offered'");
    expect(bridge).not.toContain("const routeCount =");
    expect(bridge).toContain("CURRENT_TIMESTAMP<=response_due_at AS before_due");
    expect(bridge).toContain("CURRENT_TIMESTAMP<expires_at AS before_expiry");
    expect(core).toContain("The response deadline for this operational request has passed.");
    expect(core).toContain("This operational request has expired.");
  });

  it("routes only from the authoritative opened event and leaves manual assignment on its existing path", () => {
    expect(reconciliation).toContain("staff.coverage.opened");
    expect(reconciliation).toContain("this.coverageOffers.routeFirstOffer");
    expect(reconciliation).toContain('route_kind: "automatic"');
    const manualAssignment = operations.slice(
      operations.indexOf("async assignCoverage"),
      operations.indexOf("async respondCoverage"),
    );
    expect(manualAssignment).not.toContain("routeFirstOffer");
    expect(manualAssignment).not.toContain("currentResponseBinding");
    const response = operations.slice(
      operations.indexOf("async respondCoverage"),
      operations.indexOf("async withdrawLeave"),
    );
    expect(response.indexOf("currentResponseBinding")).toBeLessThan(response.indexOf('.set({ status: data.decision'));
    expect(response).toContain("this.coverageOffers.recordResponse");
    expect(response).toContain("exact_configured_coverage_offer_recipient");
  });
});
