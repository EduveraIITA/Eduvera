import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { Selectable, Transaction } from "kysely";
import {
  DOMAIN_COMMAND_GATEWAY_PORT,
  type DomainCommandGatewayPort,
  type PreparedDomainCommand,
} from "../../campus-model-core/domain-command-gateway.port.js";
import {
  DOMAIN_COMMAND_RECEIPT_READ_PORT,
  type DomainCommandReceiptReadPort,
} from "../../campus-model-core/domain-command-receipt-read.port.js";
import {
  DOMAIN_EVENT_JOURNAL_PORT,
  type DomainEventJournalPort,
} from "../../campus-model-core/domain-event-journal.port.js";
import {
  COORDINATION_CONFIGURATION_PORT,
  coordinationConfigurationHash,
  type CoordinationConfigurationPort,
  type CoordinationRouteContent,
} from "../../campus-model-core/coordination-configuration.port.js";
import {
  COORDINATION_RUNTIME_PORT,
  type CoordinationRuntimePort,
} from "../../campus-model-core/coordination-runtime.port.js";
import { executionNow } from "../../campus-model-core/execution-time.runtime.js";
import type { ActingHumanAgentIdentity } from "../../campus-model-core/human-agent-identity.port.js";
import type { Database } from "../../database/types.js";
import type { AuthUser } from "../../common/request.js";
import type {
  AccommodationStayTable,
  AccommodationReceiptTable,
  AccommodationSetupReceiptTable,
} from "./accommodation.types.js";
import { accommodationHref } from "./accommodation.contracts.js";
type Tx = Transaction<Database>;
type Stay = Selectable<AccommodationStayTable>;
export interface AccommodationCoordinationReceipt {
  event_id: string;
  event_type: string;
  source_revision: number;
  message_id: string | null;
  recipient_user_id: string | null;
  recipient_person_id: string | null;
  route_unavailable: boolean;
  capability: string;
}
@Injectable()
export class AccommodationModel {
  constructor(
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT)
    private readonly gateway: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)
    private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT)
    private readonly journal: DomainEventJournalPort,
    @Inject(COORDINATION_CONFIGURATION_PORT)
    private readonly configuration: CoordinationConfigurationPort,
    @Inject(COORDINATION_RUNTIME_PORT)
    readonly coordination: CoordinationRuntimePort,
  ) {}
  private key(user: string, id: string) {
    return `accommodation:${user}:${id}`;
  }
  retained(tx: Tx, user: AuthUser, school: string, id: string) {
    return this.receipts.readDomainCommandReceipt(tx, {
      school_id: school,
      actor_user_id: user.id,
      source_domain: "accommodation",
      handler_key: "accommodation.commands",
      handler_version: 1,
      idempotency_key: this.key(user.id, id),
    });
  }
  async prepare(
    tx: Tx,
    user: AuthUser,
    actor: ActingHumanAgentIdentity,
    target: {
      id: string;
      school_id: string;
      revision: number;
      coordination_receipt?: unknown;
    },
    action: string,
    body: {
      command_id: string;
      expected_revision: number;
      [key: string]: unknown;
    },
    capability: string,
    authority: unknown,
  ) {
    const hash = createHash("sha256")
        .update(JSON.stringify({ source_id: target.id, action, ...body }))
        .digest("hex"),
      retained = await this.retained(
        tx,
        user,
        target.school_id,
        body.command_id,
      );
    if (retained) {
      if (
        retained.actor_agent_id !== actor.agent_id ||
        retained.command_type !== `accommodation.${action}` ||
        retained.target.domain_id !== target.id ||
        retained.expected_revision !== body.expected_revision ||
        retained.safe_context.payload_hash !== hash
      )
        throw new ConflictException(
          "This save belongs to different accommodation work.",
        );
      if (retained.state === "pending")
        throw new ConflictException({
          code: "accommodation_pending",
          message:
            "This exact action is awaiting confirmation. Retry the same save.",
        });
      if (retained.receipt.terminal_state !== "accepted")
        throw new ConflictException(
          "This exact action was not accepted. Review the current arrangement.",
        );
      return {
        replay: true as const,
        revision: retained.receipt.resulting_revision,
      };
    }
    if (target.revision !== body.expected_revision)
      throw new ConflictException({
        code: "accommodation_obsolete",
        message: "This record changed. Review its latest version.",
        fields: {
          accommodation_obsolete: {
            confirmation: "permanently_inapplicable",
            receipt_state: "absent",
            source_id: target.id,
            stay_id: target.id,
            command_id: body.command_id,
            expected_revision: body.expected_revision,
            current_revision: target.revision,
            reason: "stream_advanced",
          },
        },
      });
    const previous = target.coordination_receipt as
      | AccommodationCoordinationReceipt
      | undefined;
    const result = await this.gateway.prepareDomainCommand(tx, {
      school_id: target.school_id,
      actor_user_id: user.id,
      command_type: `accommodation.${action}`,
      handler_key: "accommodation.commands",
      handler_version: 1,
      source_domain: "accommodation",
      target: {
        kind: action.startsWith("setup.")
          ? "accommodation_setup"
          : "accommodation_stay",
        domain: "accommodation",
        domain_id: target.id,
        label: action.startsWith("setup.")
          ? "Residential setup"
          : "Accommodation",
        lifecycle_state: "active",
        source_revision: Math.max(1, target.revision),
        metadata: {},
      },
      current_revision: target.revision,
      expected_revision: body.expected_revision,
      capability,
      purpose: `accommodation_${action.replaceAll(".", "_")}`,
      requested_at: executionNow().toISOString(),
      correlation_id: target.id,
      causation_id: previous?.event_id ?? null,
      idempotency_key: this.key(user.id, body.command_id),
      operating_rule_version_ref: null,
      configuration_refs: [],
      authority_attestation: {
        evaluator_domain: "accommodation",
        decision: "allowed",
        reason_codes: [
          capability === "accommodation.manage"
            ? "explicit_current_accommodation_authority"
            : "exact_current_stay_participant",
        ],
        authority_source_refs: [authority],
        operating_rule_refs: [],
        valid_until: null,
      },
      safe_context: { source_id: target.id, payload_hash: hash },
    });
    if (result.status !== "ready")
      throw new ConflictException("Refresh this exact accommodation action.");
    return { replay: false as const, prepared: result };
  }
  private complete(
    tx: Tx,
    school: string,
    command: PreparedDomainCommand,
    id: string,
    revision: number,
    event: string | null,
  ) {
    return this.gateway.completeDomainCommand(tx, {
      school_id: school,
      command_id: command.command_id,
      terminal_state: "accepted",
      code: "accommodation_accepted",
      explanation:
        "The exact accommodation operation was recorded. Agreement, physical movement and access custody remain separate.",
      resulting_revision: revision,
      domain_event_id: event,
      metadata: { id, revision },
      completed_at: executionNow().toISOString(),
    });
  }
  async finishSetup(
    tx: Tx,
    user: AuthUser,
    receipt: Selectable<AccommodationSetupReceiptTable>,
    command: PreparedDomainCommand,
  ) {
    const payload = {
        source_id: receipt.source_id,
        kind: receipt.kind,
        revision: receipt.revision,
        source_command_id: command.command_id,
      },
      eventType = `accommodation.setup.${receipt.kind}`,
      outbox = await tx
        .insertInto("event_outbox")
        .values({
          school_id: receipt.school_id,
          event_type: eventType,
          aggregate_type: "accommodation_setup",
          aggregate_id: receipt.source_id,
          audience_user_ids: [],
          payload,
          idempotency_key: `accommodation-source:${command.command_id}`,
          created_at: receipt.recorded_at,
          notification_user_ids: [],
          notification_payload: null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, {
      school_id: receipt.school_id,
      source_outbox_event_id: outbox.id,
      event_type: eventType,
      subject: {
        kind: "accommodation_setup",
        domain: "accommodation",
        domain_id: receipt.source_id,
        label: "Residential setup",
        lifecycle_state: "active",
        source_revision: receipt.revision,
        metadata: {},
      },
      context: null,
      actor_user_id: user.id,
      occurred_at: receipt.recorded_at.toISOString(),
      effective_from: receipt.recorded_at.toISOString(),
      effective_until: null,
      source_domain: "accommodation",
      source_record_id: receipt.source_id,
      source_revision: receipt.revision,
      correlation_id: receipt.source_id,
      causation_event_id: null,
      idempotency_key: `accommodation-event:${command.command_id}`,
      payload,
      audience_user_ids: [user.id],
    });
    await this.complete(
      tx,
      receipt.school_id,
      command,
      receipt.source_id,
      receipt.revision,
      outbox.id,
    );
    await this.refresh(
      tx,
      receipt.school_id,
      receipt.source_id,
      receipt.revision,
      command.command_id,
      [user.id],
    );
  }
  private async configure(
    tx: Tx,
    user: AuthUser,
    stay: Stay,
    action: string,
    recipient: { person_id: string; user_id: string } | null,
    capability: string,
  ) {
    const at = stay.updated_at.toISOString(),
      key = `stay_${stay.id.replaceAll("-", "")}`,
      response = stay.state === "offered" || stay.proposed_ends_at !== null;
    const content: CoordinationRouteContent = {
      school_id: stay.school_id,
      actor_user_id: user.id,
      source_domain: "accommodation",
      source_record_id: stay.id,
      source_revision: stay.revision,
      configuration_key: key,
      operating_rule_ref: `accommodation-arrangement:${stay.id}:${stay.revision}`,
      effective_from: at,
      enabled: Boolean(recipient),
      behaviour_key: key,
      behaviour_schema_version: 1,
      behaviour_configuration: {
        workflow: "accommodation_stay",
        stay_id: stay.id,
        coordinator_person_id: stay.coordinator_person_id,
        recorder_person_id: stay.recorder_person_id,
        resident_person_id: stay.resident_person_id,
        stage: response ? "response" : "movement_or_access",
        assisted_response:
          response && recipient?.person_id !== stay.resident_person_id,
        timing: "no_automatic_deadline",
      },
      subscription: {
        source_domain: "accommodation",
        event_type: `accommodation.stay.${action}`,
        reaction_kind: response
          ? "accommodation_stay_response"
          : "accommodation_stay_action",
        message_kind: response ? "offer" : "task",
        selector_key: key,
        required_capability: response
          ? "accommodation.respond"
          : "accommodation.record",
        scope_mode: "event_scope",
        min_recipients: 1,
        max_recipients: 1,
        message_schema_version: 1,
        response_due_after_seconds: null,
        expires_after_seconds: null,
        retry_after_seconds: null,
        max_attempts: 1,
        priority: 3,
      },
      recipients: recipient ? [recipient] : [],
      approval_note:
        "This exact authorized arrangement explicitly names its resident, coordinator and physical recorder. No consent, physical move, key return, fee or automatic expiry is inferred.",
    };
    const configurationHash = coordinationConfigurationHash(content),
      ids: string[] = [];
    for (const phase of ["approve", "activate"] as const) {
      const prepared = await this.gateway.prepareDomainCommand(tx, {
        school_id: stay.school_id,
        actor_user_id: user.id,
        command_type: `accommodation.coordination.configure.${phase}`,
        handler_key: "accommodation.coordination.configure",
        handler_version: 1,
        source_domain: "accommodation",
        target: {
          kind: "accommodation_stay",
          domain: "accommodation",
          domain_id: stay.id,
          label: "Accommodation",
          lifecycle_state: "active",
          source_revision: stay.revision,
          metadata: {},
        },
        current_revision: stay.revision,
        expected_revision: stay.revision,
        capability,
        purpose: "explicit_stay_next_responsibility",
        requested_at: at,
        correlation_id: stay.id,
        causation_id: ids[0] ?? null,
        idempotency_key: `${key}:${stay.revision}:${phase}`,
        operating_rule_version_ref: content.operating_rule_ref,
        configuration_refs: [
          {
            kind: "accepted_arrangement",
            ref: stay.id,
            version: String(stay.revision),
          },
        ],
        authority_attestation: {
          evaluator_domain: "accommodation",
          decision: "allowed",
          reason_codes: ["explicit_current_stay_responsibility"],
          authority_source_refs: [
            {
              resident_person_id: stay.resident_person_id,
              coordinator_person_id: stay.coordinator_person_id,
              recorder_person_id: stay.recorder_person_id,
            },
          ],
          operating_rule_refs: [],
          valid_until: null,
        },
        safe_context: {
          configuration_hash: configurationHash,
          source_record_id: stay.id,
          source_revision: stay.revision,
          configuration_key: key,
        },
      });
      if (prepared.status !== "ready")
        throw new ConflictException(
          "The accommodation handoff needs a refresh.",
        );
      ids.push(prepared.command_id);
      if (phase === "approve")
        await this.complete(
          tx,
          stay.school_id,
          prepared,
          stay.id,
          stay.revision,
          null,
        );
      else {
        const configured = await this.configuration.configureRoute(tx, {
          ...content,
          configuration_hash: configurationHash,
          approval_command_id: ids[0]!,
          activation_command_id: prepared.command_id,
        });
        await this.complete(
          tx,
          stay.school_id,
          prepared,
          stay.id,
          stay.revision,
          null,
        );
        return { ...configured, selector_key: key };
      }
    }
    throw new ConflictException("Accommodation routing was not configured.");
  }
  private refresh(
    tx: Tx,
    school: string,
    id: string,
    revision: number,
    command: string,
    audience: string[],
  ) {
    return tx
      .insertInto("event_outbox")
      .values({
        school_id: school,
        event_type: "accommodation.updated",
        aggregate_type: "accommodation_stay",
        aggregate_id: id,
        audience_user_ids: [...new Set(audience)],
        payload: {
          source_id: id,
          revision,
          source_command_id: command,
          refresh: ["accommodation", "workspace", "attention"],
        },
        idempotency_key: `accommodation-refresh:${command}`,
        created_at: executionNow(),
        notification_user_ids: [],
        notification_payload: null,
      })
      .execute();
  }
  async finish(
    tx: Tx,
    user: AuthUser,
    stay: Stay,
    receipt: Selectable<AccommodationReceiptTable>,
    command: PreparedDomainCommand,
    capability: string,
    recipient: { person_id: string; user_id: string } | null,
    audience: string[],
    previous?: AccommodationCoordinationReceipt,
  ) {
    const at = stay.updated_at.toISOString(),
      eventType = `accommodation.stay.${receipt.action}`,
      payload = {
        stay_id: stay.id,
        revision: stay.revision,
        action: receipt.action,
        source_command_id: command.command_id,
      };
    const outbox = await tx
      .insertInto("event_outbox")
      .values({
        school_id: stay.school_id,
        event_type: eventType,
        aggregate_type: "accommodation_stay_event",
        aggregate_id: stay.id,
        audience_user_ids: [],
        payload,
        idempotency_key: `accommodation-source:${command.command_id}`,
        created_at: stay.updated_at,
        notification_user_ids: [],
        notification_payload: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const previousTrace = previous?.message_id
      ? await this.coordination.findExactTrace(tx, {
          school_id: stay.school_id,
          source_domain: "accommodation",
          source_record_id: stay.id,
          event_type: previous.event_type,
          source_revision: previous.source_revision,
          message_id: previous.message_id,
        })
      : null;
    if (
      previous?.message_id &&
      previous.recipient_user_id === user.id &&
      previousTrace?.message_open
    )
      await this.coordination.recordRecipientResponse(tx, {
        school_id: stay.school_id,
        message_id: previous.message_id,
        correlation_id: stay.id,
        recipient: { agent_kind: "human", user_id: user.id },
        actor: { agent_kind: "human", user_id: user.id },
        expected_source_record_id: stay.id,
        expected_source_revision: previous.source_revision,
        source_outbox_event_id: outbox.id,
        code: `accommodation_${receipt.action}`,
        explanation:
          "The exact recipient acted through the owning accommodation operation.",
        response: {
          stay_id: stay.id,
          revision: stay.revision,
          action: receipt.action,
        },
        occurred_at: at,
        idempotency_key: `accommodation-response:${command.command_id}`,
      });
    const route = await this.configure(
        tx,
        user,
        stay,
        receipt.action,
        recipient,
        capability,
      ),
      event = {
        school_id: stay.school_id,
        source_outbox_event_id: outbox.id,
        event_type: eventType,
        subject: {
          kind: "accommodation_stay",
          domain: "accommodation",
          domain_id: stay.id,
          label: "Accommodation",
          lifecycle_state: "active" as const,
          source_revision: stay.revision,
          metadata: {},
        },
        context: null,
        actor_user_id: user.id,
        occurred_at: at,
        effective_from: at,
        effective_until: null,
        source_domain: "accommodation",
        source_record_id: stay.id,
        source_revision: stay.revision,
        correlation_id: stay.id,
        causation_event_id: previous?.event_id ?? null,
        idempotency_key: `accommodation-event:${command.command_id}`,
        payload,
      };
    let eventId: string,
      messageId: string | null = null;
    if (recipient) {
      const result = await this.coordination.publishAcceptedEvent(tx, {
        ...event,
        event_kind: "domain_event",
        expected_route: {
          behaviour_version_id: route.behaviour_version_id!,
          subscription_id: route.subscription_id!,
        },
        message: {
          subject:
            stay.state === "offered" || stay.proposed_ends_at
              ? "Respond to accommodation offer"
              : "Continue accommodation arrangement",
          summary: "Open this exact stay for its current authorized action.",
          payload: {
            workflow: "accommodation_stay",
            stay_id: stay.id,
            source_revision: stay.revision,
            action_path: accommodationHref(stay.id),
          },
        },
        selector_input: {
          selector_key: route.selector_key,
          recipient_agents: [
            { agent_kind: "human", user_id: recipient.user_id },
          ],
          scope: event.subject,
        },
      });
      if (result.status !== "matched" || result.message_ids.length !== 1)
        throw new ConflictException(
          "The named next accommodation participant could not receive this work.",
        );
      eventId = result.event_id;
      messageId = result.message_ids[0]!;
    } else
      eventId = (
        await this.journal.recordAcceptedEvent(tx, {
          ...event,
          audience_user_ids: [user.id],
        })
      ).event_id;
    if (
      previous?.message_id &&
      previous.recipient_user_id !== user.id &&
      previousTrace?.message_open
    )
      await this.coordination.supersedeDomainMessage(tx, {
        school_id: stay.school_id,
        command_id: command.command_id,
        message_id: previous.message_id,
        previous_event_id: previous.event_id,
        resulting_event_id: eventId,
        required_capability: capability,
        occurred_at: at,
        idempotency_key: `accommodation-supersede:${command.command_id}`,
      });
    const result: AccommodationCoordinationReceipt = {
      event_id: eventId,
      event_type: eventType,
      source_revision: stay.revision,
      message_id: messageId,
      recipient_user_id: recipient?.user_id ?? null,
      recipient_person_id: recipient?.person_id ?? null,
      route_unavailable:
        ["offered", "accepted"].includes(stay.state) && !recipient,
      capability:
        stay.state === "offered" || stay.proposed_ends_at
          ? "accommodation.respond"
          : "accommodation.record",
    };
    await tx
      .updateTable("accommodation_stays")
      .set({ coordination_receipt: result })
      .where("school_id", "=", stay.school_id)
      .where("id", "=", stay.id)
      .execute();
    await this.complete(
      tx,
      stay.school_id,
      command,
      stay.id,
      stay.revision,
      outbox.id,
    );
    await this.refresh(
      tx,
      stay.school_id,
      stay.id,
      stay.revision,
      command.command_id,
      audience,
    );
    return result;
  }
}
