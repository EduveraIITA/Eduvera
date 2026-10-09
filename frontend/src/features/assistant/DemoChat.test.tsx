import { act,cleanup,fireEvent,render,screen } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { Link,MemoryRouter } from 'react-router-dom';
import { AssistantPanel,AssistantTab } from './DemoChat';
import { AssistantComposer } from './AssistantComposer';
import { useDemoChat } from './useDemoChat';
import type { AgentRun } from './agentApi';
import type { AgentChartData } from './agentApi';
const state=vi.hoisted(()=>({runs:[] as AgentRun[],pending:false,busy:false,awaiting:false,loading:false,error:'',status:{local:true,ready:true},send:vi.fn(),cancel:vi.fn()}));
vi.mock('./useAgentConversation',()=>({useAgentConversation:()=>state}));
const context={portal:'teacher' as const,pageTitle:'Today'};
function Harness({scope='teacher-1'}:{scope?:string}){const chat=useDemoChat(scope);return <><h1>Today</h1><Link to="/teacher/more">Elsewhere</Link><AssistantPanel chat={chat} context={context}/><AssistantTab chat={chat}/></>;}
const run=(answer:string):AgentRun=>({id:answer,question:'Question',answer,status:'completed',progress:'Complete',provider:'ollama',model:'qwen3:8b',created_at:new Date().toISOString(),action:null,evidence:[]});
const open=()=>fireEvent.click(screen.getByRole('button',{name:'Chat',exact:true}));
beforeEach(()=>{state.runs=[];state.pending=false;state.awaiting=false;state.error='';state.send.mockResolvedValue(true);});
afterEach(()=>{cleanup();vi.clearAllMocks();});
describe('connected compact assistant',()=>{
  it('shows a verified chart above the composer and replaces it with the next reply',()=>{
    const chart:AgentChartData={kind:'bar',title:'Subject attendance',scope:'My class',from:'2026-04-01',to:'2026-10-09',unit:'percent',points:[{label:'Maths',value:90,detail:'9 of 10 lessons'}],note:'Recorded data',total:1,shown:1};
    state.runs=[{...run('Here is the comparison'),evidence:[{id:'e',title:'Attendance',href:'/teacher/insights/attendance',retrieved_at:new Date().toISOString(),capability:'insights',chart}]}];
    const view=render(<MemoryRouter><Harness/></MemoryRouter>);open();
    const chartNode=screen.getByRole('region',{name:'Subject attendance'}),composer=screen.getByRole('textbox');
    expect(chartNode.compareDocumentPosition(composer)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('link',{name:'Attendance'})).toHaveAttribute('href','/teacher/insights/attendance');
    expect(screen.getByRole('link',{name:'Open full chat'})).toBeVisible();
    state.runs=[run('Next reply without a chart')];view.rerender(<MemoryRouter><Harness/></MemoryRouter>);
    expect(screen.queryByRole('region',{name:'Subject attendance'})).not.toBeInTheDocument();
  });
  it('keeps the page and only the latest animated reply',()=>{
    state.runs=[run('First reply')];const view=render(<MemoryRouter><Harness/></MemoryRouter>);open();
    expect(screen.getByRole('heading',{name:'Today'})).toBeVisible();expect(screen.getByText('First reply')).toBeVisible();
    const first=document.querySelector('.assistant-response__content');
    state.runs=[run('First reply'),run('Latest reply')];view.rerender(<MemoryRouter><Harness/></MemoryRouter>);
    expect(screen.queryByText('First reply')).not.toBeInTheDocument();expect(screen.getByText('Latest reply')).toBeVisible();
    expect(document.querySelector('.assistant-response__content')).not.toBe(first);
    expect(screen.queryByText(/Demo replies/)).not.toBeInTheDocument();
  });
  it('can expand a running server request without blocking navigation',()=>{
    state.pending=true;state.runs=[{...run(''),status:'running',progress:'Reading attendance'}];
    render(<MemoryRouter><Harness/></MemoryRouter>);open();
    expect(screen.getByRole('link',{name:'Open full chat'})).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('button',{name:'Stop request'})).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Stop request'}));expect(state.cancel).toHaveBeenCalledOnce();
  });
  it('requires a full review for a pending write, not a one-tap hidden approval',()=>{
    state.awaiting=true;state.runs=[{...run('Review this action'),action:{id:'a',title:'Send message',status:'pending',input:{basis_id:'e',body:{body:'Hello'}},labels:{},href:'/teacher/messages',expires_at:new Date().toISOString(),receipt:null}}];
    render(<MemoryRouter><Harness/></MemoryRouter>);open();
    expect(screen.getByRole('link',{name:'Review action'})).toHaveAttribute('href','/teacher/assistant');
    expect(screen.queryByRole('button',{name:'Confirm'})).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
  it('closes on Escape and isolates the active child/navigation',()=>{
    const view=render(<MemoryRouter><Harness/></MemoryRouter>);open();fireEvent.keyDown(document,{key:'Escape'});
    expect(screen.queryByRole('region',{name:'AI chat'})).not.toBeInTheDocument();
    open();view.rerender(<MemoryRouter><Harness scope="child-2"/></MemoryRouter>);
    expect(screen.queryByRole('region',{name:'AI chat'})).not.toBeInTheDocument();open();
    fireEvent.click(screen.getByRole('link',{name:'Elsewhere'}));expect(screen.queryByRole('region',{name:'AI chat'})).not.toBeInTheDocument();
  });
});
describe('assistant composer',()=>{
  it('ignores empty/shift-enter and prevents duplicate submission',async()=>{
    let finish!:(value:boolean)=>void;const send=vi.fn(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
    render(<AssistantComposer onSend={send} onCancel={()=>undefined}/>);
    fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'});expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Attendance'}});
    fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter',shiftKey:true});expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('textbox'),{key:'Enter'});expect(send).toHaveBeenCalledOnce();
    expect(screen.getByRole('button',{name:'Send message'})).toBeDisabled();
    await act(async()=>{finish(true);await Promise.resolve();});expect(screen.getByRole('textbox')).toHaveValue('');
  });
  it('keeps the draft and idempotency key after a failed connection',async()=>{
    const send=vi.fn().mockResolvedValue(false);render(<AssistantComposer onSend={send} onCancel={()=>undefined}/>);
    fireEvent.change(screen.getByRole('textbox'),{target:{value:'Check fees'}});
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Send message'}));await Promise.resolve();});
    expect(screen.getByRole('textbox')).toHaveValue('Check fees');
    await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Send message'}));await Promise.resolve();});
    expect(send.mock.calls[0]![1]).toBe(send.mock.calls[1]![1]);
  });
});
