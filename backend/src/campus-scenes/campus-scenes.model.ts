import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { sql, type Transaction } from "kysely";
import type { Database } from "../database/types.js";
import type { AuthUser } from "../common/request.js";
import type { ActingHumanAgentIdentity } from "../campus-model-core/human-agent-identity.port.js";
import {
  DOMAIN_COMMAND_GATEWAY_PORT,
  type DomainCommandGatewayPort,
  type PreparedDomainCommand,
} from "../campus-model-core/domain-command-gateway.port.js";
import {
  DOMAIN_COMMAND_RECEIPT_READ_PORT,
  type DomainCommandReceiptReadPort,
} from "../campus-model-core/domain-command-receipt-read.port.js";
import {
  DOMAIN_EVENT_JOURNAL_PORT,
  type DomainEventJournalPort,
} from "../campus-model-core/domain-event-journal.port.js";
import { executionNow } from "../campus-model-core/execution-time.runtime.js";
import {
  scenePayloadHash,
  type SceneAction,
} from "./campus-scenes.contracts.js";
import { reviewedPlaceMappingsSchema } from "./reviewed-places.contracts.js";

type Tx = Transaction<Database>;
export interface SceneCommandTarget {
  id: string;
  campus_id: string;
  revision: number;
  kind: "campus_scene" | "campus_scene_image";
}
@Injectable()
export class CampusScenesModel {
  constructor(
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT)
    private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_COMMAND_RECEIPT_READ_PORT)
    private readonly receipts: DomainCommandReceiptReadPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT)
    private readonly journal: DomainEventJournalPort,
  ) {}

  async prepare(
    tx: Tx,
    user: AuthUser,
    actor: ActingHumanAgentIdentity,
    school: string,
    target: SceneCommandTarget,
    action: SceneAction,
    body: { idempotency_key: string; expected_revision: number },
    content: unknown,
    nativeContentHash?: string,
    reviewedPlacesRequestHash?: string,
  ) {
    const key = `campus-scenes:${user.id}:${body.idempotency_key}`,
      payloadHash = scenePayloadHash({
        target_id: target.id,
        campus_id: target.campus_id,
        action,
        expected_revision: body.expected_revision,
        content,
      });
    const retained = await this.receipts.readDomainCommandReceipt(tx, {
      school_id: school,
      actor_user_id: user.id,
      source_domain: "campus_scenes",
      handler_key: "campus_scenes.commands",
      handler_version: 1,
      idempotency_key: key,
    });
    if (retained) {
      if (
        retained.actor_agent_id !== actor.agent_id ||
        retained.command_type !== `campus_scenes.${action}` ||
        retained.target.domain_id !== target.id ||
        retained.expected_revision !== body.expected_revision ||
        retained.safe_context.payload_hash !== payloadHash ||
        retained.safe_context.reviewed_places_request_hash !== reviewedPlacesRequestHash
      )
        throw new ConflictException(
          "This save key belongs to a different campus scene change.",
        );
      if (retained.state === "pending")
        throw new ConflictException({
          code: "scene_command_pending",
          message:
            "This exact change is awaiting confirmation. Retry with the same save key.",
        });
      if (retained.receipt.terminal_state !== "accepted")
        throw new ConflictException(
          "This exact change was not accepted. Review the current campus scene.",
        );
      return {
        replayed: true as const,
        revision: retained.receipt.resulting_revision!,
        metadata: retained.receipt.metadata,
      };
    }
    if (target.revision !== body.expected_revision)
      throw new ConflictException({
        code: "scene_revision_conflict",
        message: "The campus scene changed. Reload it before saving.",
        current_revision: target.revision,
      });
    const prepared = await this.commands.prepareDomainCommand(tx, {
      school_id: school,
      actor_user_id: user.id,
      command_type: `campus_scenes.${action}`,
      handler_key: "campus_scenes.commands",
      handler_version: 1,
      source_domain: "campus_scenes",
      target: {
        kind: target.kind,
        domain: "campus_scenes",
        domain_id: target.id,
        label:
          target.kind === "campus_scene"
            ? "Campus scene"
            : "Campus source image",
        lifecycle_state: "active",
        source_revision: Math.max(1, target.revision),
        metadata: { campus_id: target.campus_id },
      },
      current_revision: target.revision,
      expected_revision: body.expected_revision,
      capability: "campus_scenes:manage",
      purpose: `campus_scene_${action}`,
      requested_at: executionNow().toISOString(),
      correlation_id: target.id,
      causation_id: null,
      idempotency_key: key,
      operating_rule_version_ref: null,
      configuration_refs: [],
      authority_attestation: {
        evaluator_domain: "campus_scenes",
        decision: "allowed",
        reason_codes: [
          "active_institution_administrator",
          "explicit_campus_scene_change",
        ],
        authority_source_refs: [
          {
            campus_id: target.campus_id,
            person_id: actor.person_id,
            membership_role: "admin",
          },
        ],
        operating_rule_refs: [],
        valid_until: null,
      },
      safe_context: {
        source_id: target.id,
        campus_id: target.campus_id,
        payload_hash: payloadHash,
        ...(nativeContentHash ? { content_hash: nativeContentHash } : {}),
        ...(reviewedPlacesRequestHash ? { reviewed_places_request_hash: reviewedPlacesRequestHash } : {}),
      },
    });
    if (prepared.status !== "ready")
      throw new ConflictException("Refresh this exact campus scene change.");
    return { replayed: false as const, prepared };
  }

  /** Probe before any place creation. A retained accepted native outcome is the batch receipt. */
  async reviewedPlacesReplay(tx: Tx, user: AuthUser, actor: ActingHumanAgentIdentity, school: string,
    target: SceneCommandTarget, body: { idempotency_key: string; expected_revision: number }, requestHash: string) {
    const retained = await this.receipts.readDomainCommandReceipt(tx, { school_id: school, actor_user_id: user.id,
      source_domain: "campus_scenes", handler_key: "campus_scenes.commands", handler_version: 1,
      idempotency_key: `campus-scenes:${user.id}:${body.idempotency_key}` });
    if (!retained) return null;
    if (retained.actor_agent_id !== actor.agent_id || retained.command_type !== "campus_scenes.draft_saved"
      || retained.target.domain !== "campus_scenes" || retained.target.kind !== "campus_scene"
      || retained.target.domain_id !== target.id || retained.expected_revision !== body.expected_revision
      || retained.safe_context.campus_id !== target.campus_id || retained.safe_context.reviewed_places_request_hash !== requestHash) {
      throw new ConflictException("This save key belongs to a different reviewed campus-place change.");
    }
    if (retained.state === "pending") throw new ConflictException({ code: "scene_command_pending",
      message: "This exact place review is awaiting confirmation. Retry with the same save key." });
    if (retained.receipt.terminal_state !== "accepted" || retained.receipt.metadata.reviewed_places_request_hash !== requestHash)
      throw new ConflictException("This exact place review was not accepted. Reload the campus draft.");
    const revision = retained.receipt.resulting_revision;
    if (!Number.isSafeInteger(revision) || !revision || revision < 1 || revision > target.revision)
      throw new ConflictException("The accepted place-review revision is unavailable. Reload the campus draft.");
    const mappings = reviewedPlaceMappingsSchema.safeParse(retained.receipt.metadata.reviewed_places_mappings);
    if (!mappings.success) throw new ConflictException("The accepted place-review receipt is unavailable. Reload the campus draft.");
    return { revision, mappings: mappings.data };
  }

  async finish(
    tx: Tx,
    user: AuthUser,
    school: string,
    target: SceneCommandTarget,
    action: SceneAction,
    command: PreparedDomainCommand,
    at: Date,
    metadata: Record<string, unknown>,
  ) {
    const eventType = `campus_scenes.${action}`;
    // Draft and source changes reach administrators only; publication reaches
    // connected members without including the private source or document body.
    let audienceQuery = tx
      .selectFrom("school_memberships as membership")
      .innerJoin("users as account", "account.id", "membership.user_id")
      .select("membership.user_id")
      .where("membership.school_id", "=", school)
      .where("membership.is_active", "=", true)
      .where("account.is_active", "=", true);
    if (action !== "published")
      audienceQuery = audienceQuery.where("membership.role", "=", "admin");
    const audience = [
      ...new Set(
        (await audienceQuery.execute()).map((member) => member.user_id),
      ),
    ];
    const payload = {
      scene_id: target.id,
      campus_id: target.campus_id,
      revision: target.revision,
      action,
      source_command_id: command.command_id,
      refresh: ["campus-scenes"],
    };
    const event = await tx
      .insertInto("event_outbox")
      .values({
        school_id: school,
        event_type: eventType,
        aggregate_type: `${target.kind}_event`,
        aggregate_id: target.id,
        audience_user_ids: [],
        payload,
        idempotency_key: `campus-scene:${command.command_id}`,
        created_at: at,
        notification_user_ids: [],
        notification_payload: null,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await this.journal.recordAcceptedEvent(tx, {
      school_id: school,
      source_outbox_event_id: event.id,
      event_type: eventType,
      subject: {
        kind: target.kind,
        domain: "campus_scenes",
        domain_id: target.id,
        label:
          target.kind === "campus_scene"
            ? "Campus scene"
            : "Campus source image",
        lifecycle_state: "active",
        source_revision: target.revision,
        metadata: { campus_id: target.campus_id },
      },
      context: null,
      actor_user_id: user.id,
      occurred_at: at.toISOString(),
      effective_from: at.toISOString(),
      effective_until: null,
      source_domain: "campus_scenes",
      source_record_id: target.id,
      source_revision: target.revision,
      correlation_id: target.id,
      causation_event_id: null,
      idempotency_key: `campus-scene-event:${command.command_id}`,
      payload,
      audience_user_ids: [],
    });
    await this.commands.completeDomainCommand(tx, {
      school_id: school,
      command_id: command.command_id,
      terminal_state: "accepted",
      code: `campus_scene_${action}`,
      explanation: metadata.reviewed_places_request_hash
        ? "The reviewed native places were created or reused and connected in a saved campus draft. Geometry review and publication remain separate."
        : "The campus visualization change was recorded. This does not create operational places, routes, occupancy or authority.",
      resulting_revision: target.revision,
      domain_event_id: event.id,
      metadata: { ...metadata, id: target.id, revision: target.revision },
      completed_at: at.toISOString(),
    });
    // The source event has no recipients. Publish the refresh only after its
    // immutable journal and accepted command outcome exist in this transaction.
    const currentAudience = (
      await sql<{
        user_id: string;
      }>`SELECT user_id FROM unnest(${audience}::uuid[]) user_id WHERE campus_scene_event_recipient_valid(${school}::uuid,'campus_scenes.updated',${JSON.stringify(payload)}::jsonb,user_id)`.execute(
        tx,
      )
    ).rows.map((row) => row.user_id);
    await tx
      .insertInto("event_outbox")
      .values({
        school_id: school,
        event_type: "campus_scenes.updated",
        aggregate_type: target.kind,
        aggregate_id: target.id,
        audience_user_ids: currentAudience,
        payload,
        idempotency_key: `campus-scene-refresh:${command.command_id}`,
        created_at: at,
        notification_user_ids: [],
        notification_payload: null,
      })
      .execute();
  }
}
