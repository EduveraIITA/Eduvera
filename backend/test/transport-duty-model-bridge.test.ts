import type { Transaction } from "kysely";
import { describe,expect,it,vi } from "vitest";
import type { CoordinationRuntimePort } from "../src/campus-model-core/coordination-runtime.port.js";
import type { Database } from "../src/database/types.js";
import type { GovernanceDecisionAuthorityPort,GovernanceDecisionAuthorityReceipt } from "../src/governance/decision-authority.port.js";
import { TransportDutyModelBridgeService } from "../src/departure-coordination/transport-duty-model-bridge.service.js";

const id=(last:number)=>`00000000-0000-4000-8000-${String(last).padStart(12,"0")}`;
const ids={school:id(1),requester:id(2),target:id(3),owner:id(4),swap:id(5),trip:id(6),outbox:id(7),
  command:id(8),correlation:id(9),event:id(10),message:id(11),reaction:id(12),behaviour:id(13),subscription:id(14),
  outcome:id(15),person:id(16),office:id(17),appointment:id(18),rule:id(19),source:id(20),membership:id(21)};
const transaction={} as Transaction<Database>;
const authorityReceipt:GovernanceDecisionAuthorityReceipt={
  school_id:ids.school,matter_code:"transport_duty_change_decision",evaluated_at:"2026-10-16T10:00:00.000Z",
  effective_date:"2026-10-16",institution_timezone:"Asia/Kolkata",decision_mode:"individual",user_id:ids.owner,
  account:{id:ids.owner,is_active:true},memberships:[{id:ids.membership,role:"admin",is_active:true}],
  person:{id:ids.person,revision:1},office:{id:ids.office,revision:1,status:"active",authority_source_id:ids.source},
  appointment:{id:ids.appointment,revision:1,status:"active",appointment_kind:"appointed",starts_on:"2026-04-01",ends_on:null,authority_source_id:ids.source,evidence_reference:"appointment"},
  rule:{id:ids.rule,revision:1,status:"confirmed",decision_mode:"individual",effective_from:"2026-04-01",effective_until:null,conditions_summary:"Current owner",authority_source_ids:[ids.source]},
  sources:[{id:ids.source,revision:1,source_kind:"appointment_order",reference:"ORDER-1",provision:"Transport",evidence_reference:"document",verification_state:"verified",effective_from:"2026-04-01",effective_until:null,verified_by:ids.owner,verified_at:"2026-04-01T00:00:00.000Z"}],
};
const change={id:ids.swap,request_type:"cover" as const,requester_trip_id:ids.trip,target_trip_id:null,
  requester_user_id:ids.requester,target_user_id:ids.target,status:"submitted" as const,revision:1};

function matched(recipient:string) {
  return {status:"matched" as const,event_id:ids.event,behaviour_version_id:ids.behaviour,
    subscription_id:ids.subscription,reaction_ids:[ids.reaction],message_ids:[ids.message],deliveries:[{
      reaction_id:ids.reaction,message_id:ids.message,recipient:{agent_kind:"human" as const,user_id:recipient},
    }],replayed:false};
}

function setup() {
  const resolveDecisionOwner=vi.fn().mockResolvedValue(authorityReceipt);
  const assertDecisionAuthority=vi.fn().mockResolvedValue(authorityReceipt);
  const authority:GovernanceDecisionAuthorityPort={resolveDecisionOwner,assertDecisionAuthority};
  const publishAcceptedEvent=vi.fn()
    .mockResolvedValueOnce(matched(ids.target))
    .mockResolvedValueOnce(matched(ids.owner));
  const findExactTrace=vi.fn().mockResolvedValue({event_id:ids.event,correlation_id:ids.correlation,message_id:ids.message});
  const recordRecipientResponse=vi.fn().mockResolvedValue({message_id:ids.message,reaction_id:ids.reaction,state:"responded",outcome_id:ids.outcome,replayed:false});
  const coordination:CoordinationRuntimePort={findExactTrace,hasAcceptedSourceEvent:vi.fn(),listOperationalMessageWork:vi.fn(),
    resolveEventRoute:vi.fn(),authorizeCandidateRecipients:vi.fn(),publishAcceptedEvent,recordRecipientResponse,
    recordMessageOutcome:vi.fn()};
  return {service:new TransportDutyModelBridgeService(authority,coordination),mocks:{resolveDecisionOwner,assertDecisionAuthority,findExactTrace,publishAcceptedEvent,recordRecipientResponse}};
}

describe("transport duty model bridge",()=>{
  it("resolves an exact coordination trace through the Core port",async()=>{
    const {service,mocks}=setup();
    await expect(service.trace(transaction,ids.school,ids.swap,"transport.duty_change.requested",1))
      .resolves.toEqual({event_id:ids.event,correlation_id:ids.correlation,message_id:ids.message});
    expect(mocks.findExactTrace).toHaveBeenCalledWith(transaction,{
      school_id:ids.school,source_domain:"departure_transport",source_record_id:ids.swap,
      event_type:"transport.duty_change.requested",source_revision:1,
    });
  });

  it("publishes one privacy-minimal Offer to the selected colleague",async()=>{
    const {service,mocks}=setup();
    await service.publishRequested(transaction,{school_id:ids.school,actor_user_id:ids.requester,change,
      requester_trip_revision:3,source_outbox_event_id:ids.outbox,correlation_id:ids.correlation,
      occurred_at:"2026-10-16T10:00:00.000Z"});
    const published=mocks.publishAcceptedEvent.mock.calls[0]![1];
    expect(published).toMatchObject({event_type:"transport.duty_change.requested",source_domain:"departure_transport",
      source_record_id:ids.swap,source_revision:1,correlation_id:ids.correlation,
      selector_input:{selector_key:"transport_duty_target_colleague",recipient_agents:[{agent_kind:"human",user_id:ids.target}]},
      message:{payload:{duty_change_id:ids.swap,action_path:`/teacher/transport?swap=${ids.swap}&swap_revision=1`}}});
    expect(JSON.stringify(published)).not.toMatch(/reason|response_note|decision_note/i);
  });

  it("binds the target response to the exact offer message and source revision",async()=>{
    const {service,mocks}=setup();
    await service.recordTargetResponse(transaction,{school_id:ids.school,actor_user_id:ids.target,
      change:{...change,status:"accepted",revision:2},message_id:ids.message,source_revision:1,
      decision:"accepted",source_outbox_event_id:ids.outbox,correlation_id:ids.correlation,
      command_id:ids.command,occurred_at:"2026-10-16T10:02:00.000Z"});
    expect(mocks.recordRecipientResponse).toHaveBeenCalledWith(transaction,expect.objectContaining({
      message_id:ids.message,correlation_id:ids.correlation,recipient:{agent_kind:"human",user_id:ids.target},
      expected_source_record_id:ids.swap,expected_source_revision:1,code:"transport_duty_offer_accepted",
    }));
  });

  it("routes an accepted offer as one Request to the exact governance owner",async()=>{
    const {service,mocks}=setup();
    await expect(service.resolveDecisionOwner(transaction,ids.school,new Date("2026-10-16T10:00:00Z")))
      .resolves.toBe(authorityReceipt);
    expect(mocks.resolveDecisionOwner).toHaveBeenCalledWith(transaction,ids.school,"transport_duty_change_decision",expect.any(Date));
    await service.publishRequested(transaction,{school_id:ids.school,actor_user_id:ids.requester,change,
      requester_trip_revision:3,source_outbox_event_id:ids.outbox,correlation_id:ids.correlation,occurred_at:"2026-10-16T10:00:00.000Z"});
    await service.publishAccepted(transaction,{school_id:ids.school,actor_user_id:ids.target,
      change:{...change,status:"accepted",revision:2},source_outbox_event_id:ids.outbox,
      correlation_id:ids.correlation,causation_event_id:ids.event,occurred_at:"2026-10-16T10:02:00.000Z",
      decision_owner:authorityReceipt});
    expect(mocks.publishAcceptedEvent.mock.calls[1]![1]).toMatchObject({
      event_type:"transport.duty_change.accepted",source_revision:2,causation_event_id:ids.event,
      selector_input:{selector_key:"transport_duty_change_decision_owner",recipient_agents:[{agent_kind:"human",user_id:ids.owner}]},
      message:{payload:{action_path:`/principal/departure?section=roster&swap=${ids.swap}&swap_revision=2`}},
    });
  });

  it("records only the current governance owner's exact decision response",async()=>{
    const {service,mocks}=setup();
    await expect(service.assertDecisionAuthority(transaction,ids.school,ids.owner,new Date()))
      .resolves.toBe(authorityReceipt);
    await service.recordDecisionResponse(transaction,{school_id:ids.school,actor_user_id:ids.owner,
      change:{...change,status:"approved",revision:3},message_id:ids.message,source_revision:2,
      decision:"approved",source_outbox_event_id:ids.outbox,correlation_id:ids.correlation,
      command_id:ids.command,occurred_at:"2026-10-16T10:03:00.000Z",authority:authorityReceipt});
    expect(mocks.recordRecipientResponse).toHaveBeenCalledWith(transaction,expect.objectContaining({
      recipient:{agent_kind:"human",user_id:ids.owner},expected_source_record_id:ids.swap,
      expected_source_revision:2,code:"transport_duty_change_approved",
    }));
  });
});
