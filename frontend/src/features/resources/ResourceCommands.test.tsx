import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { askResourceQuestion, changeResourceDue, confirmResourceCommand, getResourceLoan, replyResourceQuestion, resolveResourceQuestion, returnResource, type ResourceReceipt } from "./resourceApi";
import { ResourceLoanView } from "./ResourceLoanView";
import { ResourceReturnDialog } from "./ResourceReturnDialog";
import { ResourceNoteDialog } from "./ResourceNoteDialog";
import { resourceFixtureLoan } from "./resources.test-fixtures";
import { resourceInputInstant, resourceInputTime } from "./resourceTime";

vi.mock("./resourceApi",()=>({askResourceQuestion:vi.fn(),replyResourceQuestion:vi.fn(),resolveResourceQuestion:vi.fn(),changeResourceDue:vi.fn(),confirmResourceCommand:vi.fn(),getResourceLoan:vi.fn(),returnResource:vi.fn()}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();vi.resetAllMocks();});
function mountReturn({correction=false,refresh=vi.fn().mockResolvedValue(undefined)}={}) {
  const onSaved=vi.fn(),onClose=vi.fn();
  render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceReturnDialog schoolId="school" loan={resourceFixtureLoan()} correction={correction} refresh={refresh} onClose={onClose} onSaved={onSaved} /></MemoryRouter></ExecutionEnvironmentProvider>);
  return {onSaved,onClose,refresh};
}
describe("source-bound return commands",()=>{
  it.each(["return","claim"] as const)("preserves the exact default %s instant in a paused fractional-second world",async action=>{
    const instant="2026-10-24T10:35:42.678Z",user=userEvent.setup(),refresh=vi.fn().mockResolvedValue(undefined),onSaved=vi.fn();
    const loan=resourceFixtureLoan({issued_at:instant,due_at:"2026-10-25T10:35:42.678Z",state:"outstanding",can_question:true});
    vi.mocked(returnResource).mockResolvedValue(loan);vi.mocked(askResourceQuestion).mockResolvedValue(loan);
    render(<ExecutionEnvironmentProvider environment={{mode:"simulation",namespaceId:"simulation:precision",runId:"precision-run",runStatus:"paused",virtualClock:{now:instant,timeZone:"Asia/Kolkata"}}}><MemoryRouter>{action==="return"
      ? <ResourceReturnDialog schoolId="school" loan={loan} refresh={refresh} onClose={vi.fn()} onSaved={onSaved} />
      : <ResourceNoteDialog schoolId="school" loan={loan} action="returned_claim" refresh={refresh} onClose={vi.fn()} onSaved={onSaved} />}</MemoryRouter></ExecutionEnvironmentProvider>);
    const input=screen.getByLabelText<HTMLInputElement>(action==="return" ? "Received on" : "Returned on");
    expect(input).toHaveAttribute("step","any");expect(input.checkValidity()).toBe(true);expect(resourceInputInstant(input.value)).toBe(instant);
    expect(resourceInputTime(instant)).toHaveLength(16);
    if(action==="return"){await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));}
    else{await user.type(screen.getByRole("textbox",{name:"Return details"}),"Returned to Dev at the desk");await user.click(screen.getByRole("button",{name:"Send to custodian"}));}
    await waitFor(()=>expect(onSaved).toHaveBeenCalledOnce());
    if(action==="return")expect(vi.mocked(returnResource).mock.calls[0]![2].observed_at).toBe(instant);
    else expect(vi.mocked(askResourceQuestion).mock.calls[0]![2].claimed_return_at).toBe(instant);
  });
  it("records only the received component, keeping a missing charger out",async()=>{
    const f=mountReturn(),user=userEvent.setup();vi.mocked(returnResource).mockResolvedValue(resourceFixtureLoan());
    expect(screen.getByRole("checkbox",{name:/Camera/})).not.toBeChecked();expect(screen.getByRole("checkbox",{name:/Charger/})).not.toBeChecked();
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));
    await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());
    expect(returnResource).toHaveBeenCalledWith("school","loan-1",expect.objectContaining({expected_revision:1,correction:false,parts:[{part_id:"part-camera",quantity:1,condition:"usable"}]}));
    expect(vi.mocked(returnResource).mock.calls[0]![2].command_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(f.refresh).toHaveBeenCalledOnce();
  });
  it("locks an unknown result and retries the identical command only after checking its receipt",async()=>{
    const f=mountReturn(),user=userEvent.setup();vi.mocked(returnResource).mockRejectedValueOnce(new TypeError("Connection lost")).mockResolvedValueOnce(resourceFixtureLoan());
    vi.mocked(confirmResourceCommand).mockResolvedValue({state:"not_found"});
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));
    await screen.findByText(/Connection lost/);expect(screen.getByRole("checkbox",{name:/Camera/})).toBeDisabled();expect(screen.getByRole("button",{name:"Close"})).toBeDisabled();
    expect(returnResource).toHaveBeenCalledTimes(1);await user.click(screen.getByRole("button",{name:"Check result"}));await user.click(await screen.findByRole("button",{name:"Retry same action"}));
    await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());expect(returnResource).toHaveBeenCalledTimes(2);
    expect(vi.mocked(returnResource).mock.calls[1]).toEqual(vi.mocked(returnResource).mock.calls[0]);
  });
  it("refreshes an accepted result without sending another return",async()=>{
    const refresh=vi.fn().mockRejectedValueOnce(new Error("Read unavailable")).mockResolvedValueOnce(undefined),f=mountReturn({refresh}),user=userEvent.setup();
    vi.mocked(returnResource).mockResolvedValue(resourceFixtureLoan());await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));
    await user.click(await screen.findByRole("button",{name:"Refresh saved record"}));await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());
    expect(returnResource).toHaveBeenCalledTimes(1);expect(confirmResourceCommand).not.toHaveBeenCalled();expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("requires a fresh reviewed revision after the exact permanent-stale proof",async()=>{
    const f=mountReturn(),user=userEvent.setup();
    vi.mocked(returnResource).mockImplementationOnce((_school,id,body)=>Promise.reject(new ApiError("Loan changed",409,{error:{code:"resource_loan_obsolete",fields:{resource_loan_obsolete:{confirmation:"permanently_inapplicable",receipt_state:"absent",loan_id:id,command_id:body.command_id,expected_revision:1,current_revision:2,reason:"stream_advanced"}}}}))).mockResolvedValueOnce(resourceFixtureLoan());
    vi.mocked(getResourceLoan).mockResolvedValue(resourceFixtureLoan({revision:2}));
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));
    await screen.findByRole("button",{name:"Review current record"});expect(screen.getByRole("button",{name:"Record received"})).toBeDisabled();expect(screen.getByRole("button",{name:"Close"})).toBeEnabled();
    await user.click(screen.getByRole("button",{name:"Review current record"}));await waitFor(()=>expect(screen.getByRole("button",{name:"Record received"})).toBeEnabled());
    expect(screen.getByRole("checkbox",{name:/Camera/})).toBeChecked();await user.click(screen.getByRole("button",{name:"Record received"}));await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());
    const calls=vi.mocked(returnResource).mock.calls;expect(calls[1]![2].expected_revision).toBe(2);expect(calls[1]![2].command_id).not.toBe(calls[0]![2].command_id);
  });
  it("does not unlock or rebase an opaque conflict",async()=>{
    mountReturn();const user=userEvent.setup();vi.mocked(returnResource).mockRejectedValue(new ApiError("Conflict",409));
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));await screen.findByRole("button",{name:"Check result"});
    expect(screen.queryByRole("button",{name:"Review current record"})).not.toBeInTheDocument();expect(screen.getByRole("checkbox",{name:/Camera/})).toBeDisabled();expect(returnResource).toHaveBeenCalledTimes(1);
  });
  it("unlocks a definitively refused exact retry without automatically sending a new command",async()=>{
    mountReturn();const user=userEvent.setup();vi.mocked(returnResource).mockRejectedValueOnce(new TypeError("Response lost")).mockRejectedValueOnce(new ApiError("Received quantity is invalid",422));vi.mocked(confirmResourceCommand).mockResolvedValue({state:"not_found"});
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("button",{name:"Record received"}));await user.click(await screen.findByRole("button",{name:"Check result"}));await user.click(await screen.findByRole("button",{name:"Retry same action"}));
    await screen.findByText("Received quantity is invalid");expect(screen.getByRole("checkbox",{name:/Camera/})).toBeEnabled();expect(screen.getByRole("button",{name:"Close"})).toBeEnabled();expect(screen.queryByRole("button",{name:"Check result"})).not.toBeInTheDocument();expect(returnResource).toHaveBeenCalledTimes(2);expect(vi.mocked(returnResource).mock.calls[1]).toEqual(vi.mocked(returnResource).mock.calls[0]);
  });
  it("requires a reason for a missed-return correction and retains observed time separately",async()=>{
    const f=mountReturn({correction:true}),user=userEvent.setup();vi.mocked(returnResource).mockResolvedValue(resourceFixtureLoan());
    await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.type(screen.getByRole("textbox",{name:"Correction reason"}),"The return was missed at the desk");
    fireEvent.change(screen.getByLabelText("Received on"),{target:{value:"2026-10-22T09:15"}});await user.click(screen.getByRole("button",{name:"Save correction"}));await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());
    expect(vi.mocked(returnResource).mock.calls[0]![2]).toEqual(expect.objectContaining({correction:true,reason:"The return was missed at the desk",observed_at:new Date("2026-10-22T09:15").toISOString()}));
  });
  it("can replace a completed wrong return with no received parts, without selecting issued or superseded receipts",async()=>{
    const user=userEvent.setup(),base=resourceFixtureLoan(),receipt:ResourceReceipt={id:"current-return",action:"return_corrected",actor_label:"Dev Shah",recorded_at:"2026-10-23T09:00:00Z",observed_at:"2026-10-22T09:00:00Z",reason:"Earlier repair",note:null,due_at:null,previous_due_at:null,question_id:null,supersedes_receipt_id:"old-return",parts:base.parts.map(part=>({part_id:part.id,quantity:1,condition:"usable"}))};
    const loan=resourceFixtureLoan({state:"returned",outstanding_count:0,parts:base.parts.map(part=>({...part,returned_quantity:1,outstanding_quantity:0})),history:[receipt,{...receipt,id:"old-return",action:"return_recorded",supersedes_receipt_id:null},{...receipt,id:"issue-receipt",action:"issued",supersedes_receipt_id:null}]});
    const refresh=vi.fn().mockResolvedValue(undefined);vi.mocked(returnResource).mockResolvedValue(loan);
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceLoanView schoolId="school" loan={loan} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} /></MemoryRouter></ExecutionEnvironmentProvider>);
    expect(screen.queryByRole("button",{name:"Record return"})).not.toBeInTheDocument();await user.click(screen.getByRole("button",{name:"Correct return record"}));
    const choices=screen.getByRole("combobox",{name:"Return to correct"});expect(within(choices).getAllByRole("option")).toHaveLength(2);expect(within(choices).queryByRole("option",{name:/issue-receipt|old-return/})).not.toBeInTheDocument();
    await user.selectOptions(choices,"current-return");expect(screen.getByRole("checkbox",{name:/Camera/})).toBeChecked();await user.click(screen.getByRole("checkbox",{name:/Camera/}));await user.click(screen.getByRole("checkbox",{name:/Charger/}));
    await user.type(screen.getByRole("textbox",{name:"Correction reason"}),"Wrong person was checked in");await user.click(screen.getByRole("button",{name:"Save correction"}));await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(returnResource).toHaveBeenCalledWith("school","loan-1",expect.objectContaining({correction:true,supersedes_receipt_id:"current-return",parts:[]}));
  });
});
describe("borrower question and native history",()=>{
  it("lets the exact borrower continue the open question without management or resolution controls",async()=>{
    const user=userEvent.setup(),refresh=vi.fn().mockResolvedValue(undefined),loan=resourceFixtureLoan({can_record_return:false,can_change_due:false,can_question:false,can_reply:true,can_resolve:false,questions:[{id:"question-1",kind:"question",note:"I returned this book last week",state:"open",reporter:{id:"person-1",label:"Sana Patel"},created_at:"2026-10-23T09:00:00Z",resolved_at:null,claimed_return_at:null,revision:1,replies:[]}]});vi.mocked(replyResourceQuestion).mockResolvedValue(loan);
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceLoanView schoolId="school" loan={loan} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} /></MemoryRouter></ExecutionEnvironmentProvider>);
    expect(screen.queryByRole("button",{name:"Question record"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Resolve question"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Record return"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Reply"}));await user.type(screen.getByRole("textbox",{name:"Your note"}),"The desk receipt was dated Tuesday");await user.click(screen.getByRole("button",{name:"Send reply"}));await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(replyResourceQuestion).toHaveBeenCalledWith("school","loan-1","question-1",expect.objectContaining({note:"The desk receipt was dated Tuesday"}));expect(askResourceQuestion).not.toHaveBeenCalled();expect(resolveResourceQuestion).not.toHaveBeenCalled();expect(returnResource).not.toHaveBeenCalled();
  });
  it("keeps a return claim pending custodian review, not a physical return",async()=>{
    const refresh=vi.fn().mockResolvedValue(undefined),user=userEvent.setup();vi.mocked(askResourceQuestion).mockResolvedValue(resourceFixtureLoan());
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><div className="resources-workspace"><ResourceLoanView schoolId="school" loan={resourceFixtureLoan({can_record_return:false,can_change_due:false,can_question:true,can_reply:false})} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} /></div></MemoryRouter></ExecutionEnvironmentProvider>);
    await user.click(screen.getByRole("button",{name:"I already returned this"}));expect(screen.getByText(/item stays out until the custodian confirms its return/)).toBeVisible();
    await user.type(screen.getByRole("textbox"),"Returned to Dev yesterday at the library desk");await user.click(screen.getByRole("button",{name:"Send to custodian"}));
    await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());expect(askResourceQuestion).toHaveBeenCalledWith("school","loan-1",expect.objectContaining({kind:"returned_claim",expected_revision:1}));expect(returnResource).not.toHaveBeenCalled();
    expect(screen.getByText("Charger")).toBeVisible();expect(screen.getAllByText("1 still out")).toHaveLength(2);
  });
  it("shows native observed/recorded history and retains the original correction source",async()=>{
    const user=userEvent.setup(),loan=resourceFixtureLoan({history:[{id:"receipt-1",action:"return_corrected",actor_label:"Dev Shah",observed_at:"2026-10-22T09:15:00Z",recorded_at:"2026-10-24T10:00:00Z",reason:"Missed at the desk",note:null,due_at:null,previous_due_at:null,supersedes_receipt_id:"original-receipt",question_id:null,parts:[{part_id:"part-camera",quantity:1,condition:"usable"}]}]});
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceLoanView schoolId="school" loan={loan} timezone="Asia/Kolkata" readOnly={true} refresh={vi.fn()} /></MemoryRouter></ExecutionEnvironmentProvider>);
    await user.click(screen.getByText("Loan history · 1"));const history=screen.getByText("Loan history · 1").closest("details")!;
    expect(within(history).getByText("Return corrected")).toBeVisible();expect(within(history).getByText(/Recorded/)).toBeVisible();expect(within(history).getByText(/Observed/)).toBeVisible();expect(screen.getByText(/original stays in this history/)).toBeVisible();
    expect(screen.queryByRole("button",{name:"Record return"})).not.toBeInTheDocument();
  });
  it.each([{label:"Reply",submit:"Send reply",method:replyResourceQuestion},{label:"Resolve question",submit:"Resolve question",method:resolveResourceQuestion}])("records a custodian $label on the private question without returning the item",async({label,submit,method})=>{
    const user=userEvent.setup(),refresh=vi.fn().mockResolvedValue(undefined),loan=resourceFixtureLoan({questions:[{id:"question-1",kind:"returned_claim",note:"Returned to the desk",state:"open",reporter:{id:"person-1",label:"Sana Patel"},created_at:"2026-10-23T09:00:00Z",resolved_at:null,claimed_return_at:"2026-10-22T09:00:00Z",revision:1,replies:[]}]});
    vi.mocked(method).mockResolvedValue(loan);
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceLoanView schoolId="school" loan={loan} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} /></MemoryRouter></ExecutionEnvironmentProvider>);
    expect(screen.getByRole("button",{name:"Correct return record"})).toBeEnabled();
    await user.click(screen.getByRole("button",{name:label}));await user.type(screen.getByRole("textbox",{name:"Your note"}),"Checked the desk record with the borrower");
    await user.click(within(screen.getByRole("dialog")).getByRole("button",{name:submit}));await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(method).toHaveBeenCalledWith("school","loan-1","question-1",expect.objectContaining({expected_revision:1,note:"Checked the desk record with the borrower"}));expect(returnResource).not.toHaveBeenCalled();
  });
  it("changes a due date with a reason on the same loan revision",async()=>{
    const user=userEvent.setup(),refresh=vi.fn().mockResolvedValue(undefined);vi.mocked(changeResourceDue).mockResolvedValue(resourceFixtureLoan());
    render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceLoanView schoolId="school" loan={resourceFixtureLoan()} timezone="Asia/Kolkata" readOnly={false} refresh={refresh} /></MemoryRouter></ExecutionEnvironmentProvider>);
    expect(screen.queryByRole("button",{name:"Correct return record"})).not.toBeInTheDocument();
    const due=screen.getByText("Due back").nextElementSibling!.querySelector("time")!;
    expect(due).toHaveAttribute("datetime",resourceFixtureLoan().due_at);expect(due).toHaveAttribute("title","Asia/Kolkata");
    expect(within(due).getByText("23 Oct 2026")).toBeVisible();expect(within(due).getByText("3:30 pm")).toHaveClass("resource-due-time__clock");
    await user.click(screen.getByRole("button",{name:"Change due date"}));fireEvent.change(screen.getByLabelText("New due date"),{target:{value:"2026-10-29T16:00"}});await user.type(screen.getByRole("textbox",{name:"Reason"}),"Approved project extension");await user.click(screen.getByRole("button",{name:"Save due date"}));await waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(changeResourceDue).toHaveBeenCalledWith("school","loan-1",expect.objectContaining({expected_revision:1,due_at:new Date("2026-10-29T16:00").toISOString(),reason:"Approved project extension"}));
  });
});
