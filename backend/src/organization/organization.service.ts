import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import { DOMAIN_COMMAND_GATEWAY_PORT, type DomainCommandGatewayPort } from "../campus-model-core/domain-command-gateway.port.js";
import { DOMAIN_EVENT_JOURNAL_PORT, type DomainEventJournalPort } from "../campus-model-core/domain-event-journal.port.js";
import { saveOrganizationSchema, validateOrganization, type OrganizationNode } from "./organization.contracts.js";

@Injectable()
export class OrganizationService {
  constructor(private readonly db: DatabaseService,
    @Inject(DOMAIN_COMMAND_GATEWAY_PORT) private readonly commands: DomainCommandGatewayPort,
    @Inject(DOMAIN_EVENT_JOURNAL_PORT) private readonly journal: DomainEventJournalPort) {}

  private async authorize(tx: Transaction<Database>, user: AuthUser, schoolId: string) {
    z.string().uuid().parse(schoolId);
    const membership = await tx.selectFrom("school_memberships").innerJoin("users", "users.id", "school_memberships.user_id").select("school_memberships.id")
      .where("school_memberships.school_id", "=", schoolId).where("school_memberships.user_id", "=", user.id)
      .where("school_memberships.role", "=", "admin").where("school_memberships.is_active", "=", true).where("users.is_active", "=", true).forShare().executeTakeFirst();
    if (!user.is_active || !membership) throw new ForbiddenException("An active institution administrator is required to manage organization structure.");
    return membership.id;
  }

  async workspace(user: AuthUser, schoolId: string) {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async tx => {
      await this.authorize(tx, user, schoolId);
      const structure = (await sql<{ revision: number }>`SELECT revision FROM organization_structures WHERE school_id=${schoolId}::uuid`.execute(tx)).rows[0];
      const nodes = (await sql<OrganizationNode>`SELECT n.id,n.parent_id,n.kind,n.name,n.description,n.tone,n.head_staff_id,
        COALESCE((SELECT jsonb_agg(m.staff_id ORDER BY m.staff_id) FROM organization_node_members m
          WHERE m.school_id=n.school_id AND m.node_id=n.id),'[]'::jsonb) AS member_ids
        FROM organization_nodes n WHERE n.school_id=${schoolId}::uuid ORDER BY n.sort_order,n.id`.execute(tx)).rows;
      const staff = await tx.selectFrom("staff_profiles as staff").innerJoin("school_people as person", join => join.onRef("person.id", "=", "staff.person_id").onRef("person.school_id", "=", "staff.school_id"))
        .select(["staff.id", "staff.first_name", "staff.last_name", "staff.designation", "staff.status", "person.avatar_url"])
        .where("staff.school_id", "=", schoolId).orderBy("staff.first_name").orderBy("staff.last_name").execute();
      return { revision: structure?.revision ?? 0, nodes, staff, can_edit: true };
    });
  }

  async save(user: AuthUser, schoolId: string, body: unknown) {
    const input = saveOrganizationSchema.parse(body);
    validateOrganization(input.nodes);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.db.transaction().execute(async tx => {
      const membershipId = await this.authorize(tx, user, schoolId);
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`organization:${schoolId}`},0))`.execute(tx);
      const replay = (await sql<{ revision: number; request_hash: string; nodes: OrganizationNode[] }>`
        SELECT revision,request_hash,nodes FROM organization_structure_revisions
        WHERE school_id=${schoolId}::uuid AND actor_user_id=${user.id}::uuid AND request_id=${input.request_id}::uuid`.execute(tx)).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash) throw new ConflictException("This save key was already used for different changes.");
        return { revision: replay.revision, nodes: replay.nodes, replayed: true };
      }
      await sql`INSERT INTO organization_structures(school_id) VALUES(${schoolId}::uuid) ON CONFLICT DO NOTHING`.execute(tx);
      const current = (await sql<{ revision: number }>`SELECT revision FROM organization_structures
        WHERE school_id=${schoolId}::uuid FOR UPDATE`.execute(tx)).rows[0]!;
      if (current.revision !== input.expected_revision) throw new ConflictException("The organization changed since you opened it. Your draft is preserved; reload the latest structure before saving again.");
      const staffIds = [...new Set(input.nodes.flatMap(node => [...node.member_ids, ...(node.head_staff_id ? [node.head_staff_id] : [])]))];
      if (staffIds.length) {
        const staff = await tx.selectFrom("staff_profiles").select(["id", "status"])
          .where("school_id", "=", schoolId).where("id", "in", staffIds).forShare().execute();
        if (staff.length !== staffIds.length) throw new BadRequestException("Every person must have a staff record in this institution.");
        // Keep historical inactive links, but do not introduce new inactive assignments.
        const previous = (await sql<{ staff_id: string; node_id: string }>`SELECT staff_id,node_id FROM organization_node_members WHERE school_id=${schoolId}::uuid
          UNION SELECT head_staff_id,id FROM organization_nodes WHERE school_id=${schoolId}::uuid AND head_staff_id IS NOT NULL`.execute(tx)).rows;
        for (const node of input.nodes) for (const id of [...node.member_ids, ...(node.head_staff_id ? [node.head_staff_id] : [])]) {
          if (staff.find(person => person.id === id)?.status !== "active" && !previous.some(link => link.staff_id === id && link.node_id === node.id)) {
            throw new BadRequestException("Only active staff can be added to a reporting node.");
          }
        }
      }
      const now = new Date().toISOString(), revision = current.revision + 1;
      const target = { domain: "organization", domain_id: schoolId, kind: "organization_structure", label: "Organization structure", lifecycle_state: "active" as const, source_revision: Math.max(1, current.revision), metadata: {} };
      const command = await this.commands.prepareDomainCommand(tx, {
        school_id: schoolId, actor_user_id: user.id, command_type: "organization.structure.save", handler_key: "organization.structure_save", handler_version: 1,
        source_domain: "organization", target, current_revision: current.revision, expected_revision: input.expected_revision,
        capability: "organization:manage", purpose: "maintain_reporting_structure", requested_at: now, correlation_id: input.request_id, causation_id: null,
        idempotency_key: `organization:${schoolId}:${user.id}:${input.request_id}`, operating_rule_version_ref: null, configuration_refs: [],
        authority_attestation: { evaluator_domain: "organization", decision: "allowed", reason_codes: ["active_institution_admin"], authority_source_refs: [{ membership_id: membershipId }], operating_rule_refs: [], valid_until: null },
        safe_context: { node_count: input.nodes.length, request_hash: requestHash, changes_access: false, changes_governance: false },
      });
      if (command.status !== "ready") throw new ConflictException("This command already has an outcome. Reload the structure.");
      // One aggregate replacement under the lock; prior revisions remain immutable.
      await sql`DELETE FROM organization_nodes WHERE school_id=${schoolId}::uuid`.execute(tx);
      for (const [index, node] of input.nodes.entries()) {
        await sql`INSERT INTO organization_nodes(school_id,id,parent_id,kind,name,description,tone,head_staff_id,sort_order)
          VALUES(${schoolId}::uuid,${node.id}::uuid,${node.parent_id}::uuid,${node.kind},${node.name},${node.description},${node.tone},${node.head_staff_id}::uuid,${index})`.execute(tx);
        for (const member of node.member_ids) await sql`INSERT INTO organization_node_members(school_id,node_id,staff_id)
          VALUES(${schoolId}::uuid,${node.id}::uuid,${member}::uuid)`.execute(tx);
      }
      await sql`UPDATE organization_structures SET revision=${revision},updated_at=${now}::timestamptz WHERE school_id=${schoolId}::uuid`.execute(tx);
      const audience = await tx.selectFrom("school_memberships").select("user_id").where("school_id", "=", schoolId).where("role", "=", "admin").where("is_active", "=", true).execute();
      const event = await tx.insertInto("event_outbox").values({ school_id: schoolId, event_type: "organization.structure.updated", aggregate_type: "organization_structure", aggregate_id: schoolId,
        audience_user_ids: audience.map(member => member.user_id), payload: { revision, node_count: input.nodes.length, refresh: ["organization"] },
        idempotency_key: `organization:${schoolId}:${revision}` }).returning("id").executeTakeFirstOrThrow();
      const journal = await this.journal.recordAcceptedEvent(tx, { school_id: schoolId, source_outbox_event_id: event.id, event_type: "organization.structure.updated",
        subject: { ...target, source_revision: revision }, context: null, actor_user_id: user.id, audience_user_ids: [], occurred_at: now, effective_from: now, effective_until: null,
        source_domain: "organization", source_record_id: schoolId, source_revision: revision, correlation_id: input.request_id, causation_event_id: null,
        idempotency_key: `organization:${schoolId}:${revision}`, payload: { node_count: input.nodes.length, changes_access: false } });
      await sql`INSERT INTO organization_structure_revisions(school_id,revision,actor_user_id,request_id,request_hash,nodes,command_id,event_id)
        VALUES(${schoolId}::uuid,${revision},${user.id}::uuid,${input.request_id}::uuid,${requestHash},${JSON.stringify(input.nodes)}::jsonb,${command.command_id}::uuid,${event.id}::uuid)`.execute(tx);
      await this.commands.completeDomainCommand(tx, { school_id: schoolId, command_id: command.command_id, terminal_state: "accepted", code: "organization_structure_saved",
        explanation: "Reporting structure saved. Access permissions and governance appointments are unchanged.", resulting_revision: revision, domain_event_id: journal.event_id,
        metadata: { node_count: input.nodes.length }, completed_at: now });
      return { revision, nodes: input.nodes, replayed: false };
    });
  }
}
