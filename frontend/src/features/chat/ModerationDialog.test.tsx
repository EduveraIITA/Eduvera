import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModerationDialog } from "./ModerationDialog";
import type { ChatReport, ChatReportQueue } from "./api";

const report:ChatReport={id:"report-1",message_id:"message-1",reported_by:"reporter-1",reason:"Inappropriate language",status:"open",assigned_to:"reviewer-1",reviewed_by:null,resolution_note:"",action_taken:"none",created_at:"2026-10-08T10:00:00Z",updated_at:"2026-10-08T10:00:00Z",resolved_at:null,conversation_id:"room-1",conversation_title:"Class 7A",conversation_kind:"group",group_type:null,message_body:"Reported message content",message_created_at:"2026-10-08T09:00:00Z",sender_id:"student-1",sender_name:"Aarav Sharma",reporter_name:"Teacher",assignee_name:"Reviewer",reviewer_role:"admin",can_assign:true,context_messages:[]};
const queue:ChatReportQueue={results:[report,{...report,id:"report-2",sender_name:"Resolved sender",status:"resolved",resolution_note:"Reviewed with student",action_taken:"no_action"}],summary:{open:1,under_review:0,resolved:1,dismissed:0}};
afterEach(cleanup);
function Navigation(){const location=useLocation();const [,setParams]=useSearchParams();return <><output>{location.search}</output><button onClick={()=>setParams(current=>{current.delete('report');return current;})}>Return to reports</button></>;}
function mount(search="",patch:Partial<React.ComponentProps<typeof ModerationDialog>>={}){const onUpdate=vi.fn();const onRefresh=vi.fn();const props={standalone:true,queue,reviewers:[],loading:false,pending:false,onUpdate,onRefresh,...patch};const view=render(<MemoryRouter initialEntries={['/principal/safeguarding?section=message_reports'+search]}><Navigation/><ModerationDialog {...props}/></MemoryRouter>);return {...view,onUpdate,onRefresh};}

describe("focused message reports",()=>{
  it("shows only the queue until a row opens a URL-backed report",()=>{
    mount();
    expect(screen.queryByRole('region',{name:'Report details'})).not.toBeInTheDocument();
    expect(screen.queryByText('Reported message content')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Aarav Sharma/}));
    expect(screen.getByRole('status')).toHaveTextContent('report=report-1');
    expect(screen.getByRole('region',{name:'Report details'})).toBeVisible();
    expect(screen.queryByRole('region',{name:'Safeguarding incidents'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'Resolve report'})).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox',{name:/Review notes/}),{target:{value:'Reviewed the original context.'}});
    expect(screen.getByRole('button',{name:'Resolve report'})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'Return to reports'}));
    expect(screen.getByRole('region',{name:'Safeguarding incidents'})).toBeVisible();
  });

  it("restores a resolved report and retains its status filter on return",()=>{
    mount('&report_status=resolved&report=report-2');
    expect(screen.getByText('Reviewed with student')).toBeVisible();
    fireEvent.click(screen.getByRole('button',{name:'Return to reports'}));
    expect(screen.getByRole('combobox',{name:'Report status'})).toHaveValue('resolved');
    expect(screen.getByRole('button',{name:/Resolved sender/})).toBeVisible();
    expect(screen.queryByRole('button',{name:/Aarav Sharma/})).not.toBeInTheDocument();
  });

  it("does not substitute another report when a direct link is unavailable",()=>{
    mount('&report=missing');
    expect(screen.getByText('Report unavailable')).toBeVisible();
    expect(screen.queryByText('Aarav Sharma')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Resolve report'})).not.toBeInTheDocument();
  });

  it("preserves staff assignment restrictions and sends only the selected report's action",()=>{
    const {onUpdate}=mount('&report=report-1',{staffView:true,queue:{...queue,results:[{...report,can_assign:false,reviewer_role:'staff'}]}});
    expect(screen.queryByRole('combobox',{name:'Assigned pastoral reviewer'})).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox',{name:/Review notes/}),{target:{value:'Context reviewed with school lead.'}});
    fireEvent.click(screen.getByRole('button',{name:'Resolve report'}));
    expect(onUpdate).toHaveBeenCalledWith('report-1',{status:'resolved',action:'no_action',note:'Context reviewed with school lead.'});
  });

  it("keeps the dialog variant focused and returns to its list without changing the page URL",()=>{
    mount('',{standalone:false});
    const dialog=screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button',{name:/Aarav Sharma/}));
    expect(within(dialog).queryByRole('region',{name:'Safeguarding incidents'})).not.toBeInTheDocument();
    expect(screen.getByRole('status')).not.toHaveTextContent('report=');
    fireEvent.click(within(dialog).getByRole('button',{name:'Back to reports'}));
    expect(within(dialog).getByRole('region',{name:'Safeguarding incidents'})).toBeVisible();
  });

  it("shows load errors with a retry without inventing a clear queue",()=>{
    const {onRefresh}=mount('',{queue:undefined,loadError:'Connection unavailable'});
    expect(screen.getByText('Reports could not be loaded')).toBeVisible();
    expect(screen.queryByText('No active reports')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Try again'}));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
