import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrganizationNode, StaffPerson } from '../../packages/contracts/src/wire/features/organization/api';
import { organizationDescendants, organizationOutline, organizationProblems, organizationRemove } from '../src/features/OrganizationPolicy';
const id = (number: number) => `10000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const node = (number: number, parent: number | null = null): OrganizationNode => ({ id: id(number), parent_id: parent ? id(parent) : null, name: `Team ${number}`, kind: 'team', tone: 'teal', description: '', head_staff_id: null, member_ids: [] });
test('organization rejects cycles, missing parents, duplicate identities and excessive depth', () => {
  assert.equal(organizationProblems([node(1), node(2, 1)]), '');
  assert.match(organizationProblems([node(1, 2), node(2, 1)]), /cycle/);
  assert.match(organizationProblems([node(1, 9)]), /parent/);
  assert.match(organizationProblems([node(1), node(1)]), /unique/);
  assert.match(organizationProblems(Array.from({ length: 13 }, (_, i) => node(i + 1, i || null))), /12 levels/);
  assert.deepEqual([...organizationDescendants([node(1), node(2, 1), node(3, 2), node(4)], id(1))], [id(1), id(2), id(3)]);
});
test('inactive links can be retained or removed but not newly introduced', () => {
  const staff: StaffPerson[] = [{ id: id(9), first_name: 'Asha', last_name: 'Rao', designation: 'Teacher', status: 'inactive' }], linked = { ...node(1), member_ids: [id(9)] };
  assert.match(organizationProblems([linked], staff, [node(1)]), /Only active/);
  assert.equal(organizationProblems([linked], staff, [linked]), '');
  assert.equal(organizationProblems([node(1)], staff, [linked]), '');
  assert.match(organizationProblems([{ ...linked, head_staff_id: id(8) }], staff, [linked]), /staff record/);
});
test('removing a node preserves children and staff links while search retains ancestors', () => {
  const nodes = [node(1), { ...node(2, 1), kind: 'department' as const, member_ids: [id(9)] }, node(3, 2), node(4)], removed = organizationRemove(nodes, id(2));
  assert.equal(removed.find(node => node.id === id(3))?.parent_id, id(1));
  assert.equal(removed.some(node => node.id === id(4)), true);
  assert.deepEqual(organizationOutline(nodes, 'Team 3').map(row => [row.node.id, row.depth]), [[id(1), 0], [id(2), 1], [id(3), 2]]);
  assert.deepEqual(organizationOutline(nodes, '', id(2)).map(row => row.node.id), [id(1), id(2), id(3)]);
  assert.deepEqual(nodes[1].member_ids, [id(9)]);
});
