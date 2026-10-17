import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertFutureExamStart,
} from "../src/assessments/exam-operations.service.js";
import {
  assessmentInvigilationOfferBehaviourSchema,
} from "../src/assessments/assessment-invigilation-offer-bridge.service.js";

const migration=readFileSync(
  resolve(process.cwd(),"migrations/119_assessment_invigilation_model_coordination.sql"),
  "utf8",
);
const bridge=readFileSync(
  resolve(process.cwd(),"src/assessments/assessment-invigilation-offer-bridge.service.ts"),
  "utf8",
);
const operations=readFileSync(
  resolve(process.cwd(),"src/assessments/exam-operations.service.ts"),
  "utf8",
);

describe("configured assessment invigilation Offer coordination",()=>{
  it("requires all mutable routing outcomes in approved configuration and rejects hidden defaults",()=>{
    const configuration={
      workflow:"assessment_invigilation_offer_routing",
      recipient_strategy:"administrator_selected",
      response_outcomes:{
        accepted:"readiness_recheck",
        declined:"administrator_review",
        expired:"administrator_review",
      },
    } as const;
    expect(assessmentInvigilationOfferBehaviourSchema.parse(configuration)).toEqual(configuration);
    expect(assessmentInvigilationOfferBehaviourSchema.safeParse({
      ...configuration,
      recipient_strategy:undefined,
    }).success).toBe(false);
    expect(assessmentInvigilationOfferBehaviourSchema.safeParse({
      ...configuration,
      response_outcomes:{accepted:"readiness_recheck"},
    }).success).toBe(false);
    expect(assessmentInvigilationOfferBehaviourSchema.safeParse({
      ...configuration,
      auto_accept_for_demo:true,
    }).success).toBe(false);
  });

  it("rejects a past physical-examination time before room or invigilator coordination",()=>{
    const now=new Date("2026-10-17T06:00:00.000Z");
    expect(()=>assertFutureExamStart("2026-10-17T05:59:59.999Z",now)).toThrow(/future examination time/i);
    expect(()=>assertFutureExamStart(now,now)).toThrow(/future examination time/i);
    expect(assertFutureExamStart("2026-10-17T06:00:00.001Z",now).toISOString())
      .toBe("2026-10-17T06:00:00.001Z");
    const create=operations.slice(operations.indexOf("async createForAssessment"),operations.indexOf("async createSitting"));
    const arrangements=operations.slice(operations.indexOf("async updateArrangements"),operations.indexOf("private async readinessSnapshot"));
    expect(create).toContain("assertFutureExamStart(assessment.scheduled_at)");
    expect(arrangements).toContain("assertFutureExamStart(data.scheduled_at)");
  });

  it("retains one immutable tenant-bound assignment revision to operational-message binding",()=>{
    expect(migration).toContain("CREATE TABLE public.assessment_invigilation_offer_bindings");
    expect(migration).toContain("UNIQUE(school_id,assignment_id,source_assignment_revision)");
    expect(migration).toContain("assessment_invigilation_offer_bindings_current_idx");
    expect(migration).toContain("REFERENCES public.campus_model_behaviour_versions(id,school_id)");
    expect(migration).toContain("REFERENCES public.campus_model_event_subscriptions(id,behaviour_version_id,school_id)");
    expect(migration).toContain("REFERENCES public.campus_model_operational_messages(id,school_id)");
    expect(migration).toContain("Invigilation Offer binding evidence is immutable");
    expect(migration).toContain("Invigilation Offer binding history is append-only");
    expect(migration).toContain("CREATE TABLE public.assessment_invigilation_commands");
    expect(migration).toContain("PRIMARY KEY(school_id,actor_id,command_id)");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  });

  it("publishes the typed accepted event only through the Core port to the exact configured human recipient",()=>{
    expect(bridge).toContain('source_domain:"assessments"');
    expect(bridge).toContain('event_type:"assessment.invigilation.offered"');
    expect(bridge).toContain('route.message_kind!=="offer"');
    expect(bridge).toContain("route.selector.min_recipients!==1");
    expect(bridge).toContain("route.selector.max_recipients!==1");
    expect(bridge).toContain("this.coordination.resolveEventRoute");
    expect(bridge).toContain("this.coordination.authorizeCandidateRecipients");
    expect(bridge).toContain("this.coordination.publishAcceptedEvent");
    expect(bridge).toContain('recipient_agents:[{agent_kind:"human",user_id:context.selected_user_id}]');
    expect(bridge).toContain("expected_route:{behaviour_version_id:route.behaviour_version_id,subscription_id:route.subscription_id}");
    expect(bridge).not.toMatch(/(?:FROM|JOIN|INSERT INTO|UPDATE)\s+campus_model_/i);
  });

  it("binds an accept or decline to the exact current recipient, assignment revision and message deadline",()=>{
    expect(bridge).toContain("CURRENT_TIMESTAMP<=response_due_at AS before_due");
    expect(bridge).toContain("CURRENT_TIMESTAMP<expires_at AS before_expiry");
    expect(bridge).toContain("input.actor_user_id!==input.binding.selected_user_id");
    expect(bridge).toContain("input.assignment.user_id!==input.binding.selected_user_id");
    expect(bridge).toContain("input.source_assignment_revision!==input.binding.source_assignment_revision");
    expect(bridge).toContain("this.coordination.recordRecipientResponse");
    expect(bridge).toContain("ON CONFLICT(school_id,actor_id,command_id) DO NOTHING");
    expect(bridge).toContain("This invigilation response command was already used for different work.");

    const response=operations.slice(operations.indexOf("async respondInvigilator"),operations.indexOf("async prepareForSchedule"));
    expect(response.indexOf("retainedResponseCommand")).toBeLessThan(response.indexOf("forUpdate()"));
    expect(response.indexOf("currentResponseBinding")).toBeLessThan(response.indexOf('updateTable("assessment_sitting_invigilators")'));
    expect(response).toContain("this.invigilationOffers.recordResponse");
    expect(response).toContain("Only the invited invigilator can respond.");
  });

  it("cancels old responsibility before a material arrangement revision publishes its replacement",()=>{
    const arrangements=operations.slice(operations.indexOf("async updateArrangements"),operations.indexOf("private async readinessSnapshot"));
    expect(arrangements).toContain("this.invigilationOffers.cancelOpenOffer");
    expect(arrangements).toContain("this.invigilationOffers.publishOffer");
    expect(arrangements.indexOf("cancelOpenOffer")).toBeLessThan(arrangements.indexOf('set({status:"offered"'));
    expect(arrangements.indexOf("updatedSitting")).toBeLessThan(arrangements.indexOf("publishOffer"));
  });

  it("projects the exact offered account required by a configured development actor",()=>{
    const projection=operations.slice(operations.indexOf("async projection"));
    expect(projection).toContain("assignment.*,account.username");
    expect(projection).toContain("JOIN users account ON account.id=assignment.user_id");
  });
});
