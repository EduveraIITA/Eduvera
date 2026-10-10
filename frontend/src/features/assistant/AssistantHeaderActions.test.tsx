import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {AssistantHeaderActions} from './AssistantHeaderActions';

afterEach(cleanup);

describe('AssistantHeaderActions',()=>{
  const threads=[
    {id:'thread-1',title:'Attendance for Aarav',updated_at:'2026-10-10T08:30:00Z'},
    {id:'thread-2',title:'Weekly planning',updated_at:'2026-10-10T08:20:00Z'},
  ];

  it('keeps conversation navigation and new chat in one labelled control group',()=>{
    const onSelect=vi.fn(),onNewChat=vi.fn();
    render(<AssistantHeaderActions threads={threads} currentThreadId="thread-1" onSelect={onSelect} onNewChat={onNewChat}/>);
    const controls=screen.getByLabelText('Chat controls');
    fireEvent.click(within(controls).getByRole('button',{name:'Open conversations'}));
    expect(within(controls).getByRole('button',{name:'Attendance for Aarav'})).toHaveAttribute('aria-current','true');
    fireEvent.click(within(controls).getByRole('button',{name:'Weekly planning'}));
    expect(onSelect).toHaveBeenCalledWith('thread-2');
    expect(within(controls).queryByText('Conversations')).not.toBeVisible();
    fireEvent.click(within(controls).getByRole('button',{name:'Start a new chat'}));
    expect(onNewChat).toHaveBeenCalledOnce();
  });
});
