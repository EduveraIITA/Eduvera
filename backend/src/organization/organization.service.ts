import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { sql, type Transaction } from "kysely";
import { z } from "zod";
import type { AuthUser } from "../common/request.js";
import { DatabaseService } from "../database/database.service.js";
import type { Database } from "../database/types.js";
import {
  saveOrganizationSchema,
  validateOrganization,
  type OrganizationNode,
} from "./organization.contracts.js";

interface OrganizationStaff {
  id: string;
  first_name: string;
  last_name: string;
  designation: string;
  status: "active" | "inactive" | "onboarding";
  avatar_url: string | null;
}

@Injectable()
export class OrganizationService {
  constructor(private readonly db: DatabaseService) {}

  private async authorize(
    transaction: Transaction<Database>,
    user: AuthUser,
    schoolId: string,
  ): Promise<void> {
    z.string().uuid().parse(schoolId);
    const membership = await transaction
      .selectFrom("school_memberships")
      .innerJoin("users", "users.id", "school_memberships.user_id")
      .select("school_memberships.id")
      .where("school_memberships.school_id", "=", schoolId)
      .where("school_memberships.user_id", "=", user.id)
      .where("school_memberships.role", "=", "admin")
      .where("school_memberships.is_active", "=", true)
      .where("users.is_active", "=", true)
      .forShare()
      .executeTakeFirst();
    if (!user.is_active || !membership) {
      throw new ForbiddenException(
        "An active institution administrator is required to manage the organization.",
      );
    }
  }

  async workspace(user: AuthUser, schoolId: string) {
    return this.db.transaction().setIsolationLevel("repeatable read").execute(async (transaction) => {
      await this.authorize(transaction, user, schoolId);
      const structure = (await sql<{ revision: number }>`
        SELECT revision
        FROM organization_structures
        WHERE school_id=${schoolId}::uuid
      `.execute(transaction)).rows[0];
      const nodes = (await sql<OrganizationNode>`
        SELECT node.id,node.parent_id,node.kind,node.name,node.description,node.tone,node.head_staff_id,
          COALESCE((
            SELECT jsonb_agg(member.staff_id ORDER BY member.staff_id)
            FROM organization_node_members member
            WHERE member.school_id=node.school_id AND member.node_id=node.id
          ),'[]'::jsonb) AS member_ids
        FROM organization_nodes node
        WHERE node.school_id=${schoolId}::uuid
        ORDER BY node.sort_order,node.id
      `.execute(transaction)).rows;
      const staff = (await sql<OrganizationStaff>`
        SELECT profile.id,profile.first_name,profile.last_name,profile.designation,
          profile.status,account.avatar_url
        FROM staff_profiles profile
        LEFT JOIN users account ON account.id=profile.user_id
        WHERE profile.school_id=${schoolId}::uuid
        ORDER BY profile.status,profile.first_name,profile.last_name
      `.execute(transaction)).rows;
      return { revision: structure?.revision ?? 0, nodes, staff, can_edit: true };
    });
  }

  async save(user: AuthUser, schoolId: string, body: unknown) {
    const input = saveOrganizationSchema.parse(body);
    validateOrganization(input.nodes);
    const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    return this.db.transaction().execute(async (transaction) => {
      await this.authorize(transaction, user, schoolId);
      await sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${`organization:${schoolId}`},0))
      `.execute(transaction);

      const replay = (await sql<{
        revision: number;
        request_hash: string;
        nodes: OrganizationNode[];
      }>`
        SELECT revision,request_hash,nodes
        FROM organization_structure_revisions
        WHERE school_id=${schoolId}::uuid
          AND actor_user_id=${user.id}::uuid
          AND request_id=${input.request_id}::uuid
      `.execute(transaction)).rows[0];
      if (replay) {
        if (replay.request_hash !== requestHash) {
          throw new ConflictException("This save key was already used for different changes.");
        }
        return { revision: replay.revision, nodes: replay.nodes, replayed: true };
      }

      await sql`
        INSERT INTO organization_structures(school_id)
        VALUES(${schoolId}::uuid)
        ON CONFLICT DO NOTHING
      `.execute(transaction);
      const current = (await sql<{ revision: number }>`
        SELECT revision
        FROM organization_structures
        WHERE school_id=${schoolId}::uuid
        FOR UPDATE
      `.execute(transaction)).rows[0]!;
      if (current.revision !== input.expected_revision) {
        throw new ConflictException(
          "The organization changed since you opened it. Your draft is preserved; load the latest structure before saving again.",
        );
      }

      const staffIds = [...new Set(input.nodes.flatMap((node) => [
        ...node.member_ids,
        ...(node.head_staff_id ? [node.head_staff_id] : []),
      ]))];
      if (staffIds.length) {
        const staff = await transaction
          .selectFrom("staff_profiles")
          .select(["id", "status"])
          .where("school_id", "=", schoolId)
          .where("id", "in", staffIds)
          .forShare()
          .execute();
        if (staff.length !== staffIds.length) {
          throw new BadRequestException(
            "Every person in the organization must have a staff record in this institution.",
          );
        }
        const previous = (await sql<{ staff_id: string; node_id: string }>`
          SELECT staff_id,node_id
          FROM organization_node_members
          WHERE school_id=${schoolId}::uuid
          UNION
          SELECT head_staff_id,id
          FROM organization_nodes
          WHERE school_id=${schoolId}::uuid AND head_staff_id IS NOT NULL
        `.execute(transaction)).rows;
        for (const node of input.nodes) {
          const assigned = [...node.member_ids, ...(node.head_staff_id ? [node.head_staff_id] : [])];
          for (const staffId of assigned) {
            const status = staff.find((person) => person.id === staffId)?.status;
            const alreadyLinked = previous.some(
              (link) => link.staff_id === staffId && link.node_id === node.id,
            );
            if (status !== "active" && !alreadyLinked) {
              throw new BadRequestException(
                "Only active staff can be added to an organization node.",
              );
            }
          }
        }
      }

      await sql`DELETE FROM organization_nodes WHERE school_id=${schoolId}::uuid`.execute(transaction);
      for (const [sortOrder, node] of input.nodes.entries()) {
        await sql`
          INSERT INTO organization_nodes(
            school_id,id,parent_id,kind,name,description,tone,head_staff_id,sort_order
          ) VALUES(
            ${schoolId}::uuid,${node.id}::uuid,${node.parent_id}::uuid,${node.kind},
            ${node.name},${node.description},${node.tone},${node.head_staff_id}::uuid,${sortOrder}
          )
        `.execute(transaction);
        for (const staffId of node.member_ids) {
          await sql`
            INSERT INTO organization_node_members(school_id,node_id,staff_id)
            VALUES(${schoolId}::uuid,${node.id}::uuid,${staffId}::uuid)
          `.execute(transaction);
        }
      }

      const revision = current.revision + 1;
      await sql`
        UPDATE organization_structures
        SET revision=${revision},updated_at=now()
        WHERE school_id=${schoolId}::uuid
      `.execute(transaction);
      const audience = await transaction
        .selectFrom("school_memberships")
        .innerJoin("users", "users.id", "school_memberships.user_id")
        .select("school_memberships.user_id")
        .where("school_memberships.school_id", "=", schoolId)
        .where("school_memberships.role", "=", "admin")
        .where("school_memberships.is_active", "=", true)
        .where("users.is_active", "=", true)
        .execute();
      const event = await transaction.insertInto("event_outbox").values({
        school_id: schoolId,
        event_type: "organization.structure.updated",
        aggregate_type: "organization_structure",
        aggregate_id: schoolId,
        audience_user_ids: audience.map((member) => member.user_id),
        payload: {
          revision,
          node_count: input.nodes.length,
          refresh: ["organization"],
          changes_access: false,
          changes_governance: false,
        },
        idempotency_key: `organization:${schoolId}:${revision}`,
      }).returning("id").executeTakeFirstOrThrow();
      await transaction.insertInto("audit_events").values({
        action: "organization.structure.saved",
        actor_id: user.id,
        school_id: schoolId,
        target_type: "organization_structure",
        target_id: schoolId,
        request_id: input.request_id,
        ip_hash: null,
        metadata: {
          revision,
          node_count: input.nodes.length,
          request_hash: requestHash,
          changes_access: false,
          changes_governance: false,
        },
      }).execute();
      await sql`
        INSERT INTO organization_structure_revisions(
          school_id,revision,actor_user_id,request_id,request_hash,nodes,event_id
        ) VALUES(
          ${schoolId}::uuid,${revision},${user.id}::uuid,${input.request_id}::uuid,
          ${requestHash},${JSON.stringify(input.nodes)}::jsonb,${event.id}::uuid
        )
      `.execute(transaction);
      return { revision, nodes: input.nodes, replayed: false };
    });
  }
}
