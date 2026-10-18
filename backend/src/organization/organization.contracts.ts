import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export const organizationNodeSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid().nullable(),
  kind: z.enum(["leadership", "department", "team", "position"]),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000),
  tone: z.enum(["violet", "blue", "teal", "rose", "slate"]),
  head_staff_id: z.string().uuid().nullable(),
  member_ids: z.array(z.string().uuid()).max(500),
}).strict();

export const saveOrganizationSchema = z.object({
  expected_revision: z.number().int().nonnegative(),
  request_id: z.string().uuid(),
  nodes: z.array(organizationNodeSchema).max(250),
}).strict();

export type OrganizationNode = z.infer<typeof organizationNodeSchema>;

export function validateOrganization(nodes: OrganizationNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length) {
    throw new BadRequestException("Each organization node must have a unique identity.");
  }
  for (const node of nodes) {
    if (new Set(node.member_ids).size !== node.member_ids.length) {
      throw new BadRequestException("A staff member can appear only once in the same node.");
    }
    const visited = new Set([node.id]);
    let parent = node.parent_id;
    while (parent) {
      if (visited.has(parent)) {
        throw new BadRequestException("Reporting lines cannot form a cycle.");
      }
      const ancestor = byId.get(parent);
      if (!ancestor) {
        throw new BadRequestException("Every reporting parent must belong to this organization.");
      }
      visited.add(parent);
      if (visited.size > 12) {
        throw new BadRequestException("Use at most 12 levels of reporting.");
      }
      parent = ancestor.parent_id;
    }
  }
}
