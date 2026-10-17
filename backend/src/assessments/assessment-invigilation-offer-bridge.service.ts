import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { sql, type Selectable, type Transaction } from "kysely";
import { z } from "zod";
import {
  COORDINATION_RUNTIME_PORT,
  type CoordinationRuntimePort,
  type OperationalMessageOutcomeReceipt,
} from "../campus-model-core/coordination-runtime.port.js";
import type { AssessmentSittingInvigilatorTable, Database } from "../database/types.js";

export const ASSESSMENT_INVIGILATION_SELECTOR_KEY = "assessment_invigilation_recipient";

export const assessmentInvigilationOfferBehaviourSchema = z.object({
  workflow: z.literal("assessment_invigilation_offer_routing"),
  recipient_strategy: z.literal("administrator_selected"),
  response_outcomes: z.object({
    accepted: z.literal("readiness_recheck"),
    declined: z.literal("administrator_review"),
    expired: z.literal("administrator_review"),
  }).strict(),
}).strict();

type OfferContext = {
  assignment_id:string;
  school_id:string;
  sitting_id:string;
  assessment_id:string;
  selected_user_id:string;
  assignment_revision:number;
  assignment_status:"offered"|"accepted"|"declined"|"revoked";
  assigned_at:Date|string;
  assessment_title:string;
  subject_name:string;
  class_name:string;
  starts_at:Date|string;
  ends_at:Date|string;
  space_name:string;
};

export interface AssessmentInvigilationOfferBinding {
  binding_id:string;
  message_id:string;
  correlation_id:string;
  source_assignment_revision:number;
  selected_user_id:string;
  behaviour_version_id:string;
  subscription_id:string;
  response_due_at:string;
  expires_at:string;
}

type RetainedBinding = AssessmentInvigilationOfferBinding & {
  status:"offered"|"accepted"|"declined"|"expired"|"cancelled";
  model_event_id:string;
  reaction_id:string;
};

@Injectable()
export class AssessmentInvigilationOfferBridgeService {
  constructor(
    @Inject(COORDINATION_RUNTIME_PORT)
    private readonly coordination:CoordinationRuntimePort,
  ){}

  private async context(
    transaction:Transaction<Database>,
    schoolId:string,
    assignmentId:string,
  ):Promise<OfferContext>{
    const context=(await sql<OfferContext>`SELECT assignment.id AS assignment_id,
        assignment.school_id,assignment.sitting_id,assignment.assessment_id,
        assignment.user_id AS selected_user_id,assignment.revision AS assignment_revision,
        assignment.status AS assignment_status,assignment.assigned_at,
        assessment.title AS assessment_title,subject.name AS subject_name,
        concat('Class ',section.grade,section.section) AS class_name,
        sitting.starts_at,sitting.ends_at,space.name AS space_name
      FROM assessment_sitting_invigilators assignment
      JOIN assessment_sittings sitting ON sitting.school_id=assignment.school_id
        AND sitting.id=assignment.sitting_id AND sitting.assessment_id=assignment.assessment_id
      JOIN assessments assessment ON assessment.school_id=assignment.school_id
        AND assessment.id=assignment.assessment_id
      JOIN subjects subject ON subject.school_id=assessment.school_id
        AND subject.id=assessment.subject_id
      JOIN class_sections section ON section.school_id=assessment.school_id
        AND section.id=assessment.class_section_id
      JOIN campus_spaces space ON space.school_id=sitting.school_id AND space.id=sitting.space_id
      WHERE assignment.school_id=${schoolId}::uuid AND assignment.id=${assignmentId}::uuid
      FOR UPDATE OF assignment`.execute(transaction)).rows[0];
    if(!context) throw new ConflictException("The invigilation assignment is no longer available.");
    return context;
  }

  private async retained(
    transaction:Transaction<Database>,
    schoolId:string,
    assignmentId:string,
    sourceRevision:number,
  ){
    return (await sql<RetainedBinding>`SELECT id AS binding_id,status,message_id,
        correlation_id,source_assignment_revision,selected_user_id,
        behaviour_version_id,subscription_id,model_event_id,reaction_id,
        response_due_at::text,expires_at::text
      FROM assessment_invigilation_offer_bindings
      WHERE school_id=${schoolId}::uuid AND assignment_id=${assignmentId}::uuid
        AND source_assignment_revision=${sourceRevision}
      FOR UPDATE`.execute(transaction)).rows[0]??null;
  }

  private async routeRound(transaction:Transaction<Database>,schoolId:string,assignmentId:string){
    return (await sql<{round:number}>`SELECT COALESCE(max(route_round),0)::int+1 AS round
      FROM assessment_invigilation_offer_bindings
      WHERE school_id=${schoolId}::uuid AND assignment_id=${assignmentId}::uuid`
      .execute(transaction)).rows[0]!.round;
  }

  private async enqueueOfferEvent(
    transaction:Transaction<Database>,
    context:OfferContext,
    actorUserId:string,
  ){
    const audience=[...new Set([actorUserId,context.selected_user_id])].sort();
    const payload={
      assignment_id:context.assignment_id,
      sitting_id:context.sitting_id,
      assessment_id:context.assessment_id,
      recipient_user_id:context.selected_user_id,
      revision:context.assignment_revision,
      refresh:["assessments","requests","attention","teacher.home","principal.home"],
    };
    const idempotencyKey=`assessment.invigilation.offered:${context.assignment_id}:${context.assignment_revision}`;
    const inserted=(await sql<{id:string}>`INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key
      ) VALUES(
        ${context.school_id}::uuid,'assessment.invigilation.offered',
        'assessment_sitting_invigilator',${context.assignment_id}::uuid,
        ${audience}::uuid[],${JSON.stringify(payload)}::jsonb,${idempotencyKey}
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
    if(inserted) return inserted.id;
    const retained=(await sql<{id:string;exact:boolean}>`SELECT id,
        school_id=${context.school_id}::uuid
          AND event_type='assessment.invigilation.offered'
          AND aggregate_type='assessment_sitting_invigilator'
          AND aggregate_id=${context.assignment_id}::uuid
          AND audience_user_ids=${audience}::uuid[]
          AND payload=${JSON.stringify(payload)}::jsonb AS exact
      FROM event_outbox WHERE idempotency_key=${idempotencyKey} FOR UPDATE`
      .execute(transaction)).rows[0];
    if(!retained?.exact) throw new ConflictException("The retained invigilation Offer event belongs to different evidence.");
    return retained.id;
  }

  async publishOffer(
    transaction:Transaction<Database>,
    input:{school_id:string;actor_user_id:string;assignment_id:string;source_assignment_revision:number},
  ):Promise<AssessmentInvigilationOfferBinding>{
    const prior=await this.retained(transaction,input.school_id,input.assignment_id,input.source_assignment_revision);
    if(prior){
      if(prior.status!=="offered") throw new ConflictException("This invigilation Offer revision is already closed.");
      return prior;
    }
    const context=await this.context(transaction,input.school_id,input.assignment_id);
    if(context.assignment_status!=="offered"||context.assignment_revision!==input.source_assignment_revision){
      throw new ConflictException("The invigilation assignment changed before its Offer could be routed.");
    }
    const occurredAt=new Date().toISOString();
    const route=await this.coordination.resolveEventRoute(transaction,{
      school_id:input.school_id,
      source_domain:"assessments",
      event_type:"assessment.invigilation.offered",
      selector_key:ASSESSMENT_INVIGILATION_SELECTOR_KEY,
      occurred_at:occurredAt,
    });
    if(route.status!=="matched"){
      throw new ConflictException("No approved invigilation Offer behaviour is active for this institution.");
    }
    const configuration=assessmentInvigilationOfferBehaviourSchema.safeParse(route.behaviour_configuration);
    const invalid=!configuration.success
      || route.configuration_schema_version!==1
      || route.message_kind!=="offer"
      || route.selector.selector_key!==ASSESSMENT_INVIGILATION_SELECTOR_KEY
      || route.selector.scope_mode!=="institution"
      || route.selector.min_recipients!==1
      || route.selector.max_recipients!==1
      || route.response_due_after_seconds===null
      || route.response_due_after_seconds<=0
      || route.expires_after_seconds===null
      || route.expires_after_seconds<=0
      || route.response_due_after_seconds>route.expires_after_seconds;
    if(invalid) throw new ConflictException("The approved invigilation Offer behaviour is incomplete or invalid.");

    const authorization=await this.coordination.authorizeCandidateRecipients(transaction,{
      school_id:input.school_id,
      behaviour_version_id:route.behaviour_version_id,
      subscription_id:route.subscription_id,
      occurred_at:occurredAt,
      recipients:[{agent_kind:"human",user_id:context.selected_user_id}],
      scope:null,
    });
    if(authorization.authorised.length!==1
      || authorization.authorised[0]?.agent_kind!=="human"
      || authorization.authorised[0].user_id!==context.selected_user_id
      || authorization.unresolved.length
      || authorization.unauthorized.length){
      throw new ConflictException("The selected invigilator is not currently authorized to receive this Offer.");
    }

    const sourceOutboxEventId=await this.enqueueOfferEvent(transaction,context,input.actor_user_id);
    const correlationId=randomUUID();
    const publish=await this.coordination.publishAcceptedEvent(transaction,{
      school_id:input.school_id,
      source_outbox_event_id:sourceOutboxEventId,
      event_kind:"domain_event",
      event_type:"assessment.invigilation.offered",
      subject:{
        kind:"assessment_invigilation_assignment",
        domain:"assessments",
        domain_id:context.assignment_id,
        label:`Invigilation · ${context.assessment_title}`,
        lifecycle_state:"active",
        source_revision:context.assignment_revision,
        metadata:{assessment_id:context.assessment_id,sitting_id:context.sitting_id},
      },
      context:null,
      actor_user_id:input.actor_user_id,
      occurred_at:occurredAt,
      effective_from:occurredAt,
      effective_until:null,
      source_domain:"assessments",
      source_record_id:context.assignment_id,
      source_revision:context.assignment_revision,
      correlation_id:correlationId,
      causation_event_id:null,
      idempotency_key:`assessment-invigilation-offer:${context.assignment_id}:${context.assignment_revision}`,
      expected_route:{behaviour_version_id:route.behaviour_version_id,subscription_id:route.subscription_id},
      payload:{
        assignment_id:context.assignment_id,
        assessment_id:context.assessment_id,
        sitting_id:context.sitting_id,
        revision:context.assignment_revision,
      },
      message:{
        subject:"Invigilation duty offered",
        summary:`${context.class_name} · ${context.subject_name} needs your response.`,
        payload:{
          assignment_id:context.assignment_id,
          assessment_id:context.assessment_id,
          sitting_id:context.sitting_id,
          source_revision:context.assignment_revision,
          starts_at:new Date(context.starts_at).toISOString(),
          ends_at:new Date(context.ends_at).toISOString(),
          space_name:context.space_name,
          action_path:`/teacher/assessments?assessment=${context.assessment_id}`,
        },
      },
      selector_input:{
        selector_key:ASSESSMENT_INVIGILATION_SELECTOR_KEY,
        recipient_agents:[{agent_kind:"human",user_id:context.selected_user_id}],
        scope:null,
      },
    });
    if(publish.status!=="matched"
      || publish.behaviour_version_id!==route.behaviour_version_id
      || publish.subscription_id!==route.subscription_id
      || publish.deliveries.length!==1
      || publish.deliveries[0]?.recipient.agent_kind!=="human"
      || publish.deliveries[0].recipient.user_id!==context.selected_user_id
      || publish.route_snapshot?.message_kind!=="offer"
      || !publish.route_snapshot.response_due_at
      || !publish.route_snapshot.expires_at){
      throw new ConflictException("The configured invigilation Offer route changed while it was being published.");
    }
    const round=await this.routeRound(transaction,input.school_id,context.assignment_id);
    const explanation="The administrator-selected invigilator received one configured, capability-checked Offer.";
    const row=(await sql<RetainedBinding>`INSERT INTO assessment_invigilation_offer_bindings(
        school_id,assignment_id,sitting_id,assessment_id,route_round,status,
        source_assignment_revision,source_outbox_event_id,routed_by,selected_user_id,
        behaviour_version_id,subscription_id,model_event_id,reaction_id,message_id,
        correlation_id,selector_key,required_capability,response_due_at,expires_at,
        behaviour_snapshot,selector_snapshot,explanation
      ) VALUES(
        ${input.school_id}::uuid,${context.assignment_id}::uuid,${context.sitting_id}::uuid,
        ${context.assessment_id}::uuid,${round},'offered',${context.assignment_revision},
        ${sourceOutboxEventId}::uuid,${input.actor_user_id}::uuid,${context.selected_user_id}::uuid,
        ${route.behaviour_version_id}::uuid,${route.subscription_id}::uuid,
        ${publish.event_id}::uuid,${publish.deliveries[0].reaction_id}::uuid,
        ${publish.deliveries[0].message_id}::uuid,${correlationId}::uuid,
        ${ASSESSMENT_INVIGILATION_SELECTOR_KEY},${route.selector.required_capability},
        ${publish.route_snapshot.response_due_at}::timestamptz,
        ${publish.route_snapshot.expires_at}::timestamptz,
        ${JSON.stringify({
          behaviour_key:route.behaviour_key,
          version:route.behaviour_version,
          configuration_schema_version:route.configuration_schema_version,
          configuration:configuration.data,
          subscription:{
            subscription_key:route.subscription_key,
            reaction_kind:route.reaction_kind,
            message_kind:route.message_kind,
            message_schema_version:route.message_schema_version,
            response_due_after_seconds:route.response_due_after_seconds,
            expires_after_seconds:route.expires_after_seconds,
          },
        })}::jsonb,
        ${JSON.stringify({selector:route.selector,recipient_user_id:context.selected_user_id})}::jsonb,
        ${explanation}
      ) RETURNING id AS binding_id,status,message_id,correlation_id,
        source_assignment_revision,selected_user_id,behaviour_version_id,subscription_id,
        model_event_id,reaction_id,response_due_at::text,expires_at::text`
      .execute(transaction)).rows[0];
    if(!row) throw new ConflictException("The invigilation Offer binding could not be retained.");
    return row;
  }

  async currentResponseBinding(
    transaction:Transaction<Database>,
    input:{school_id:string;assignment_id:string;assignment_revision:number;selected_user_id:string},
  ):Promise<AssessmentInvigilationOfferBinding|null>{
    const rows=(await sql<RetainedBinding&{before_due:boolean;before_expiry:boolean}>`SELECT
        id AS binding_id,status,message_id,correlation_id,source_assignment_revision,
        selected_user_id,behaviour_version_id,subscription_id,model_event_id,reaction_id,
        response_due_at::text,expires_at::text,
        CURRENT_TIMESTAMP<=response_due_at AS before_due,
        CURRENT_TIMESTAMP<expires_at AS before_expiry
      FROM assessment_invigilation_offer_bindings
      WHERE school_id=${input.school_id}::uuid AND assignment_id=${input.assignment_id}::uuid
        AND source_assignment_revision=${input.assignment_revision}
        AND selected_user_id=${input.selected_user_id}::uuid AND status='offered'
      FOR UPDATE`.execute(transaction)).rows;
    if(rows.length===0) return null;
    if(rows.length!==1) throw new ConflictException("The exact current invigilation Offer binding is missing or ambiguous.");
    const binding=rows[0]!;
    if(!binding.before_due) throw new ConflictException("The response deadline for this invigilation Offer has passed.");
    if(!binding.before_expiry) throw new ConflictException("This invigilation Offer has expired.");
    return binding;
  }

  async cancelOpenOffer(
    transaction:Transaction<Database>,
    input:{school_id:string;assignment_id:string;source_assignment_revision:number;occurred_at:string;reason:string},
  ){
    const binding=await this.retained(transaction,input.school_id,input.assignment_id,input.source_assignment_revision);
    if(!binding||binding.status!=="offered") return null;
    const outcome=await this.coordination.recordMessageOutcome(transaction,{
      school_id:input.school_id,
      message_id:binding.message_id,
      state:"cancelled",
      actor:null,
      source_outbox_event_id:null,
      code:"assessment_invigilation_offer_replaced",
      explanation:input.reason,
      response:null,
      occurred_at:input.occurred_at,
      idempotency_key:`assessment-invigilation-offer-cancel:${input.assignment_id}:${binding.message_id}:${input.source_assignment_revision}`,
    });
    const closed=(await sql<{id:string}>`UPDATE assessment_invigilation_offer_bindings
      SET status='cancelled',responded_at=${input.occurred_at}::timestamptz
      WHERE id=${binding.binding_id}::uuid AND school_id=${input.school_id}::uuid
        AND status='offered' AND message_id=${binding.message_id}::uuid
      RETURNING id`.execute(transaction)).rows[0];
    if(!closed) throw new ConflictException("The previous invigilation Offer was already closed.");
    return outcome;
  }

  async retainedResponseCommand(
    transaction:Transaction<Database>,
    input:{school_id:string;actor_user_id:string;command_id:string;assignment_id:string;decision:"accepted"|"declined";request_hash:string},
  ):Promise<Selectable<AssessmentSittingInvigilatorTable>|null>{
    const retained=(await sql<{assignment_id:string;decision:"accepted"|"declined";request_hash:string;result:Selectable<AssessmentSittingInvigilatorTable>}>`SELECT assignment_id,decision,request_hash,result
      FROM assessment_invigilation_commands
      WHERE school_id=${input.school_id}::uuid AND actor_id=${input.actor_user_id}::uuid
        AND command_id=${input.command_id}::uuid
      FOR UPDATE`.execute(transaction)).rows[0];
    if(!retained) return null;
    if(retained.assignment_id!==input.assignment_id||retained.decision!==input.decision||retained.request_hash!==input.request_hash){
      throw new ConflictException("This invigilation response command was already used for different work.");
    }
    return retained.result;
  }

  private async enqueueResponseEvent(
    transaction:Transaction<Database>,
    input:{school_id:string;actor_user_id:string;assignment_id:string;sitting_id:string;assessment_id:string;decision:"accepted"|"declined";resulting_revision:number;command_id:string},
  ){
    const payload={
      assignment_id:input.assignment_id,
      sitting_id:input.sitting_id,
      assessment_id:input.assessment_id,
      decision:input.decision,
      revision:input.resulting_revision,
      refresh:["assessments","requests","attention","teacher.home","principal.home"],
    };
    const idempotencyKey=`assessment.invigilation.response:${input.actor_user_id}:${input.command_id}`;
    const inserted=(await sql<{id:string}>`INSERT INTO event_outbox(
        school_id,event_type,aggregate_type,aggregate_id,audience_user_ids,payload,idempotency_key
      ) VALUES(
        ${input.school_id}::uuid,'assessment.invigilation.responded',
        'assessment_sitting_invigilator',${input.assignment_id}::uuid,
        ${[input.actor_user_id]}::uuid[],${JSON.stringify(payload)}::jsonb,${idempotencyKey}
      ) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`.execute(transaction)).rows[0];
    if(inserted) return inserted.id;
    const retained=(await sql<{id:string;exact:boolean}>`SELECT id,
        school_id=${input.school_id}::uuid
          AND event_type='assessment.invigilation.responded'
          AND aggregate_type='assessment_sitting_invigilator'
          AND aggregate_id=${input.assignment_id}::uuid
          AND audience_user_ids=${[input.actor_user_id]}::uuid[]
          AND payload=${JSON.stringify(payload)}::jsonb AS exact
      FROM event_outbox WHERE idempotency_key=${idempotencyKey} FOR UPDATE`
      .execute(transaction)).rows[0];
    if(!retained?.exact) throw new ConflictException("The retained invigilation response event belongs to different evidence.");
    return retained.id;
  }

  async recordResponse(
    transaction:Transaction<Database>,
    input:{
      school_id:string;actor_user_id:string;assignment:Selectable<AssessmentSittingInvigilatorTable>;
      source_assignment_revision:number;decision:"accepted"|"declined";command_id:string;
      request_hash:string;occurred_at:string;binding:AssessmentInvigilationOfferBinding;
    },
  ):Promise<OperationalMessageOutcomeReceipt>{
    if(input.actor_user_id!==input.binding.selected_user_id
      || input.assignment.user_id!==input.binding.selected_user_id
      || input.source_assignment_revision!==input.binding.source_assignment_revision){
      throw new ConflictException("Only the exact current invigilation Offer recipient can respond.");
    }
    const responseOutboxEventId=await this.enqueueResponseEvent(transaction,{
      school_id:input.school_id,
      actor_user_id:input.actor_user_id,
      assignment_id:input.assignment.id,
      sitting_id:input.assignment.sitting_id,
      assessment_id:input.assignment.assessment_id,
      decision:input.decision,
      resulting_revision:input.assignment.revision,
      command_id:input.command_id,
    });
    const outcome=await this.coordination.recordRecipientResponse(transaction,{
      school_id:input.school_id,
      message_id:input.binding.message_id,
      correlation_id:input.binding.correlation_id,
      recipient:{agent_kind:"human",user_id:input.binding.selected_user_id},
      actor:{agent_kind:"human",user_id:input.actor_user_id},
      expected_source_record_id:input.assignment.id,
      expected_source_revision:input.binding.source_assignment_revision,
      source_outbox_event_id:responseOutboxEventId,
      code:input.decision==="accepted"
        ? "assessment_invigilation_offer_accepted"
        : "assessment_invigilation_offer_declined",
      explanation:input.decision==="accepted"
        ? "The specifically offered invigilator accepted the duty."
        : "The specifically offered invigilator declined the duty.",
      response:{
        assignment_id:input.assignment.id,
        assessment_id:input.assignment.assessment_id,
        decision:input.decision,
        resulting_revision:input.assignment.revision,
      },
      occurred_at:input.occurred_at,
      idempotency_key:`assessment-invigilation-response:${input.assignment.id}:${input.binding.message_id}:${input.actor_user_id}:${input.command_id}`,
    });
    const closed=(await sql<{id:string}>`UPDATE assessment_invigilation_offer_bindings
      SET status=${input.decision},response_outbox_event_id=${responseOutboxEventId}::uuid,
        responded_at=${input.occurred_at}::timestamptz
      WHERE id=${input.binding.binding_id}::uuid AND school_id=${input.school_id}::uuid
        AND status='offered' AND message_id=${input.binding.message_id}::uuid
      RETURNING id`.execute(transaction)).rows[0];
    if(!closed) throw new ConflictException("The invigilation Offer was already closed.");

    const result=JSON.stringify(input.assignment);
    const inserted=(await sql<{command_id:string}>`INSERT INTO assessment_invigilation_commands(
        school_id,actor_id,command_id,assignment_id,command_type,decision,request_hash,
        source_assignment_revision,resulting_assignment_revision,result,
        response_outbox_event_id,message_id,correlation_id
      ) VALUES(
        ${input.school_id}::uuid,${input.actor_user_id}::uuid,${input.command_id}::uuid,
        ${input.assignment.id}::uuid,'respond',${input.decision},${input.request_hash},
        ${input.source_assignment_revision},${input.assignment.revision},${result}::jsonb,
        ${responseOutboxEventId}::uuid,${input.binding.message_id}::uuid,
        ${input.binding.correlation_id}::uuid
      ) ON CONFLICT(school_id,actor_id,command_id) DO NOTHING RETURNING command_id`
      .execute(transaction)).rows[0];
    if(!inserted){
      const replay=await this.retainedResponseCommand(transaction,{
        school_id:input.school_id,
        actor_user_id:input.actor_user_id,
        command_id:input.command_id,
        assignment_id:input.assignment.id,
        decision:input.decision,
        request_hash:input.request_hash,
      });
      if(!replay) throw new ConflictException("The invigilation response command could not be retained.");
    }
    return outcome;
  }
}
