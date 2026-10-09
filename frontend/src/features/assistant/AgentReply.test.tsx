import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ActionReview,AgentReply } from './AgentReply';
import type { AgentAction } from './agentApi';
const action:AgentAction={id:'a1',title:'Send school message',status:'pending',input:{id:'conversation',body:{body:'Please bring the workbook.'},basis_id:'e1'},labels:{conversation:'Class 6A parents'},href:'/teacher/messages?conversation=conversation',expires_at:'2026-10-09T10:00:00Z',receipt:null};
afterEach(cleanup);
describe('reviewed agent actions',()=>{
  it('shows a human-readable one-student change without raw IDs or revisions',()=>{
    const decide=vi.fn();
    render(<MemoryRouter><ActionReview action={{...action,capability:'record_student_attendance',title:'Record one student’s attendance',input:{body:{student_id:'private-internal-id',expected_revision:17},basis_id:'e1'},preview:{student:'Aarav Sharma',class_name:'Class 7A',date:'2026-10-09',previous_status:'Not marked',status:'present',register_note:'Only this student will be recorded. The class register stays open.'}}} busy={false} onDecide={decide}/></MemoryRouter>);
    expect(screen.getByText('Aarav Sharma · Class 7A')).toBeVisible();expect(screen.getByText('Present')).toBeVisible();
    expect(screen.getByText('Review required')).toBeVisible();expect(screen.getByText('Nothing has changed.')).toBeVisible();
    expect(screen.getByRole('group',{name:/Attendance changes from Not marked to Present/})).toBeVisible();
    expect(screen.getByText(/class register stays open/)).toBeVisible();
    expect(screen.queryByText('private-internal-id')).not.toBeInTheDocument();expect(screen.queryByText('Expected revision')).not.toBeInTheDocument();
    expect(decide).not.toHaveBeenCalled();
  });
  it('shows the recipient and exact contents and never auto-confirms',()=>{
    const decide=vi.fn();render(<MemoryRouter><ActionReview action={action} busy={false} onDecide={decide}/></MemoryRouter>);
    expect(screen.getByText('Class 6A parents')).toBeVisible();expect(screen.getByText('Please bring the workbook.')).toBeVisible();expect(decide).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Confirm'}));expect(decide).toHaveBeenCalledWith('a1','confirm');
  });
  it('does not expose an unlabeled internal target in the approval heading',()=>{
    render(<MemoryRouter><ActionReview action={{...action,input:{...action.input,id:'private-internal-id'},labels:{}}} busy={false} onDecide={vi.fn()}/></MemoryRouter>);
    expect(screen.getByText('Affected record')).toBeVisible();
    expect(screen.queryByText('private-internal-id')).not.toBeInTheDocument();
  });
  it('prevents repeated confirmation while checking the result',()=>{
    render(<MemoryRouter><ActionReview action={action} busy onDecide={vi.fn()}/></MemoryRouter>);
    expect(screen.getByRole('button',{name:'Checking…'})).toBeDisabled();expect(screen.getByRole('button',{name:'Dismiss'})).toBeDisabled();
  });
  it('provides an app verification link and trace receipt after success',()=>{
    render(<MemoryRouter><ActionReview action={{...action,status:'succeeded',receipt:{message:'The app confirmed this action.',request_id:'trace-1',completed_at:'2026-10-09T09:55:00Z'}}} busy={false} onDecide={vi.fn()}/></MemoryRouter>);
    expect(screen.queryByRole('button',{name:'Confirm'})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Verify in app'})).toHaveAttribute('href',action.href);
    fireEvent.click(screen.getByText('Action receipt'));expect(screen.getByText('Reference trace-1')).toBeVisible();
  });
  it('shows uncertainty without describing a failed connection as success',()=>{
    render(<MemoryRouter><ActionReview action={{...action,status:'uncertain',receipt:{message:'Check the affected screen before trying again.'}}} busy={false} onDecide={vi.fn()}/></MemoryRouter>);
    expect(screen.getByText('Uncertain')).toBeVisible();expect(screen.queryByRole('button',{name:'Confirm'})).not.toBeInTheDocument();
  });
  it('renders model HTML as text and exposes only verified source links',()=>{
    render(<MemoryRouter><AgentReply run={{id:'r',question:'Hi',answer:'**93%** <img src=x onerror=alert(1)> [Fake](https://evil.example)',status:'completed',progress:'Complete',provider:'ollama',model:'qwen3:8b',created_at:'2026-10-09T09:55:00Z',evidence:[{id:'e',title:'Attendance',href:'/student/attendance',retrieved_at:'2026-10-09T09:55:00Z',capability:'my_attendance'}],action:null}} busy={false} onDecide={vi.fn()}/></MemoryRouter>);
    expect(document.querySelector('img')).toBeNull();expect(document.querySelector('strong')?.textContent).toBe('93%');expect(screen.queryByRole('link',{name:'Fake'})).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Source checked'));expect(screen.getByRole('link',{name:'Attendance'})).toHaveAttribute('href','/student/attendance');
  });
});
