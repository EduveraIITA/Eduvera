import { z } from "zod";
import type { Transaction } from "kysely";
import type { Database } from "../database/types.js";
import { campusModelEntitySchema } from "./contracts.js";

/** Source-owned informational facts. This port never grants authority or creates agents. */
export const PEOPLE_RELATIONSHIP_PROJECTION_PORT = Symbol("PEOPLE_RELATIONSHIP_PROJECTION_PORT");
export const peopleRelationshipEdgeSchema = z.object({
  relation_type: z.enum(["member_of", "mentor_of", "part_of"]),
  source_record_id: z.string().uuid(), source_revision: z.number().int().positive(),
  source: campusModelEntitySchema, target: campusModelEntitySchema,
  effective_from: z.string().datetime({ offset: true }),
  effective_until: z.string().datetime({ offset: true }).nullable(),
}).strict().superRefine((edge, context) => {
  const kinds = edge.relation_type === "member_of" ? ["person", "participation_group"]
    : edge.relation_type === "mentor_of" ? ["person", "person"] : ["participation_group", "participation_group"];
  if (edge.source.kind !== kinds[0] || edge.target.kind !== kinds[1]
    || edge.source.domain !== "people" || edge.target.domain !== "people" || edge.source.domain_id === edge.target.domain_id) {
    context.addIssue({ code: "custom", message: "The relationship endpoints do not match the reviewed People contract." });
  }
  if (edge.effective_until && Date.parse(edge.effective_until) <= Date.parse(edge.effective_from)) {
    context.addIssue({ code: "custom", message: "A relationship must have a positive effective interval." });
  }
});
export const peopleRelationshipProjectionSchema = z.object({
  school_id: z.string().uuid(), actor_user_id: z.string().uuid(), command_id: z.string().uuid(),
  prepared_request_hash: z.string().regex(/^[a-f0-9]{64}$/), subject: campusModelEntitySchema,
  edges: z.array(peopleRelationshipEdgeSchema).max(4000),
}).strict().superRefine((input, context) => {
  if (input.subject.domain !== "people" || !["participation_group", "person_connection"].includes(input.subject.kind)) {
    context.addIssue({ code: "custom", message: "Only a People-owned group or connection can project these facts." });
  }
  const seen = new Set<string>();
  for (const edge of input.edges) {
    const owned = edge.relation_type === "member_of" ? edge.target.domain_id === input.subject.domain_id
      : edge.relation_type === "part_of" ? edge.source.domain_id === input.subject.domain_id
        : edge.source_record_id === input.subject.domain_id;
    if (!owned || seen.has(edge.source_record_id)) context.addIssue({ code: "custom", message: "The projection contains a foreign or repeated owning record." });
    seen.add(edge.source_record_id);
  }
});
export type PeopleRelationshipProjection = z.infer<typeof peopleRelationshipProjectionSchema>;
export type PeopleRelationshipEdge = z.infer<typeof peopleRelationshipEdgeSchema>;
export interface PeopleRelationshipProjectionPort {
  projectPeopleRelationships(tx: Transaction<Database>, input: PeopleRelationshipProjection): Promise<{ relationship_ids: string[]; replayed: boolean }>;
}
