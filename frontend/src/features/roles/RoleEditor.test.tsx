import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoleEditor } from './RoleEditor';
import { saveRole } from './api';
vi.mock('./api',()=>({saveRole:vi.fn()}));
const permissions=[{code:'attendance.view',group:'Attendance',label:'View registers',description:'Assigned classes only'},{code:'attendance.record',group:'Attendance',label:'Record attendance',description:'Submit records'},{code:'fees.manage',group:'Finance',label:'Manage fees',description:'Record receipts'}];
afterEach(cleanup);
beforeEach(()=>{vi.mocked(saveRole).mockResolvedValue({});});
describe('custom role checkbox editor',()=>{
  it('groups permissions, selects a group, saves exact selections',async()=>{
    const user=userEvent.setup();const saved=vi.fn().mockResolvedValue(undefined);
    render(<RoleEditor school="school" role={null} permissions={permissions} onSaved={saved} onCancel={vi.fn()}/>);
    await user.type(screen.getByLabelText('Role name'),'Class Observer');
    await user.click(screen.getByLabelText('Select all in Attendance'));
    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Record attendance/));
    await user.click(screen.getByRole('button',{name:'Save role'}));
    expect(saveRole).toHaveBeenCalledWith('school',{name:'Class Observer',description:'',permissions:['attendance.view']},undefined);expect(saved).toHaveBeenCalled();
  });
  it('keeps hidden selections when searching and sends the current revision',async()=>{
    const user=userEvent.setup();render(<RoleEditor school="school" role={{id:'role',name:'Accountant',description:'Finance',permissions:['fees.manage'],revision:4,member_count:1}} permissions={permissions} onSaved={vi.fn()} onCancel={vi.fn()}/>);
    await user.type(screen.getByLabelText('Find a permission'),'register');expect(screen.queryByLabelText(/Manage fees/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'Save role'}));expect(saveRole).toHaveBeenCalledWith('school',{name:'Accountant',description:'Finance',permissions:['fees.manage'],expected_revision:4},'role');
  });
  it('preserves entered selections on conflict and shows the server error',async()=>{
    vi.mocked(saveRole).mockRejectedValue(new Error('This role changed. Refresh before saving.'));const user=userEvent.setup();
    render(<RoleEditor school="school" role={null} permissions={permissions} onSaved={vi.fn()} onCancel={vi.fn()}/>);
    await user.type(screen.getByLabelText('Role name'),'Observer');await user.click(screen.getByLabelText(/View registers/));await user.click(screen.getByRole('button',{name:'Save role'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('This role changed');expect(screen.getByLabelText(/View registers/)).toBeChecked();
  });
});
