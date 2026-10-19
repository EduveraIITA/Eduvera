import { createHash } from 'node:crypto';
import type { OrganizationNode } from './organization.contracts.js';

export interface OrganizationRole { id: string; name: string; description: string; member_ids: string[] }

// Stable draft IDs let concurrent first-time editors use the same starting chart.
function nodeId(schoolId: string, key: string) {
  const hex = createHash('sha256').update(`${schoolId}:organization:${key}`).digest('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export function initialOrganization(schoolId: string, schoolName: string, roles: OrganizationRole[]): OrganizationNode[] {
  const root = nodeId(schoolId, 'institution');
  return [{ id: root, parent_id: null, kind: 'leadership', name: schoolName.slice(0,120),
    description: '', tone: 'violet', head_staff_id: null, member_ids: [] },
  ...roles.map((role): OrganizationNode => ({
    id: nodeId(schoolId, role.id), parent_id: root, kind: 'team', name: role.name,
    description: role.description, tone: role.id === 'admin' ? 'blue' : 'teal',
    head_staff_id: null, member_ids: [...new Set(role.member_ids)],
  }))];
}
