import {useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,cleanup,fireEvent} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {AttendanceDateControl} from './AttendanceDateControl';
vi.mock('../../lib/schoolTime', () => ({schoolDateToday: () => '2026-10-08'}));
afterEach(cleanup);
function Demo(){const [date,setDate]=useState('2026-10-08');return <AttendanceDateControl date={date} onChange={setDate}/>;}
it('uses the shared native picker, never expands inline, and hides Today on the current date',async()=>{
  render(<Demo/>);
  expect(screen.queryByRole('group',{name:'Choose date'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Expand calendar/})).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/Go to today/})).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Choose date'),{target:{value:'2026-10-12'}});
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-12');
  await userEvent.click(screen.getByRole('button',{name:/Go to today/}));
  expect(screen.queryByRole('group',{name:'Choose date'})).not.toBeInTheDocument();
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-08');
  expect(screen.queryByRole('button',{name:/Go to today/})).not.toBeInTheDocument();
});
it('moves exactly one day with the arrow buttons',async()=>{
  render(<Demo/>);await userEvent.click(screen.getByRole('button',{name:'Next day'}));
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-09');
  await userEvent.click(screen.getByRole('button',{name:'Previous day'}));
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-08');
});
it('does not change the register when its unsaved-work guard rejects Today or date entry',async()=>{
  const change=vi.fn(()=>false);
  render(<AttendanceDateControl date="2026-10-12" onChange={change}/>);
  await userEvent.click(screen.getByRole('button',{name:/Go to today/}));
  expect(change).toHaveBeenCalledWith('2026-10-08');
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-12');
  fireEvent.change(screen.getByLabelText('Choose date'),{target:{value:'2026-10-09'}});
  expect(screen.getByLabelText('Choose date')).toHaveValue('2026-10-12');
});
