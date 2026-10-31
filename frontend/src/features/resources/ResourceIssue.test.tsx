import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { createCampus } from "../office/api";
import { createResourceItem, getResourceOptions, issueResource, type ResourceItemCreation } from "./resourceApi";
import { ResourceItemDialog } from "./ResourceItemDialog";
import { ResourceIssueDialog } from "./ResourceIssueDialog";
import { resourceFixtureItemCreation, resourceFixtureLoan, resourceFixtureOptions } from "./resources.test-fixtures";

vi.mock("./resourceApi",async original=>({...await original<typeof import("./resourceApi")>(),getResourceOptions:vi.fn(),createResourceItem:vi.fn(),issueResource:vi.fn()}));
vi.mock("../office/api",()=>({createCampus:vi.fn()}));
vi.mock("./ResourceBorrowerPicker",()=>({ResourceBorrowerPicker:({onSelected}:{onSelected:(person:{id:string;name:string;revision:number})=>void})=><div role="dialog" aria-label="Choose borrower"><button onClick={()=>onSelected({id:"person-passive",name:"Sana Patel",revision:4})}>Choose Sana</button></div>}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();vi.resetAllMocks();});
beforeEach(()=>{vi.mocked(getResourceOptions).mockResolvedValue(resourceFixtureOptions());});
function mountItem({campuses=resourceFixtureOptions().campuses}={}){
  const onCreated=vi.fn<(result:ResourceItemCreation)=>void>(),onClose=vi.fn(),refresh=vi.fn<()=>Promise<unknown>>().mockResolvedValue(undefined);
  render(<ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceItemDialog schoolId="school" options={resourceFixtureOptions({campuses})} timezone="Asia/Kolkata" refresh={refresh} onClose={onClose} onCreated={onCreated} /></MemoryRouter></ExecutionEnvironmentProvider>);
  return {onCreated,onClose,refresh};
}
function mountIssue(){
  const onSaved=vi.fn(),refresh=vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceIssueDialog schoolId="school" actorId="actor" timezone="Asia/Kolkata" refresh={refresh} onClose={vi.fn()} onSaved={onSaved} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return {onSaved,refresh};
}
describe("minimal exact resource issue",()=>{
  it("requires an explicit copy, borrower, due time and custody confirmation",async()=>{
    const f=mountIssue(),user=userEvent.setup();vi.mocked(issueResource).mockImplementation((_school,body)=>Promise.resolve(resourceFixtureLoan({id:body.command_id})));
    const copy=await screen.findByRole("combobox",{name:"Available copy"});expect(copy).toHaveValue("");expect(screen.getByRole("button",{name:"Issue item"})).toBeDisabled();expect(issueResource).not.toHaveBeenCalled();
    await user.selectOptions(copy,"item-1");await user.click(screen.getByRole("button",{name:"Choose or add a person"}));await user.click(screen.getByRole("button",{name:"Choose Sana"}));
    fireEvent.change(screen.getByLabelText("Due back"),{target:{value:"2026-10-28T16:00"}});await user.type(screen.getByRole("textbox",{name:"Purpose"}),"Website project photography");
    expect(screen.getByRole("button",{name:"Issue item"})).toBeDisabled();await user.click(screen.getByRole("checkbox",{name:/taking responsibility/}));await user.click(screen.getByRole("button",{name:"Issue item"}));
    await waitFor(()=>expect(f.onSaved).toHaveBeenCalledOnce());expect(issueResource).toHaveBeenCalledWith("school",expect.objectContaining({expected_revision:0,holding_id:"item-1",borrower_person_id:"person-passive",components:[],custody_confirmed:true,custody_purpose:"Website project photography",due_at:new Date("2026-10-28T16:00").toISOString()}));expect(f.onSaved).toHaveBeenCalledWith(vi.mocked(issueResource).mock.calls[0]![1].command_id);
  });
  it("selects only the first accepted copy of a batch, even outside the bounded options page",async()=>{
    mountIssue();const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"Add item"}));
    await user.type(screen.getByRole("textbox",{name:"Item name"}),"New microscope");fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:"10"}});await user.type(screen.getByRole("textbox",{name:/Tag prefix/}),"MIC");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");
    vi.mocked(createResourceItem).mockImplementation((_school,body)=>Promise.resolve(resourceFixtureItemCreation(body.command_id,body.quantity,{name:body.name,asset_tag:body.asset_tag ?? "AUTO-001"})));
    expect(screen.getByText("10 separate copies will be created.")).toBeVisible();expect(screen.getByRole("textbox",{name:/Tag prefix/})).toHaveAttribute("maxlength","76");
    await user.click(within(screen.getByRole("dialog",{name:"Add an item"})).getByRole("button",{name:"Add 10 copies"}));await waitFor(()=>expect(screen.getByRole("combobox",{name:"Available copy"})).not.toHaveValue(""));
    expect(screen.getByRole("option",{name:/New microscope/})).toBeInTheDocument();expect(getResourceOptions).toHaveBeenLastCalledWith("school",expect.objectContaining({holding_id:vi.mocked(createResourceItem).mock.calls[0]![1].command_id}));
    expect(screen.getByRole("combobox",{name:"Available copy"})).toHaveValue(vi.mocked(createResourceItem).mock.calls[0]![1].command_id);expect(screen.getByText("10 copies added · 1 selected to issue.")).toBeVisible();
    expect(createResourceItem).toHaveBeenCalledWith("school",expect.objectContaining({quantity:10,asset_tag:"MIC"}));expect(issueResource).not.toHaveBeenCalled();
  });
});
describe("individually tracked copy quantities",()=>{
  it.each([1,10])("allows %i copies with automatically generated tags and no extra entry",async quantity=>{
    const f=mountItem(),user=userEvent.setup();expect(screen.getByRole("spinbutton",{name:"Quantity"})).toHaveValue(1);
    await user.type(screen.getByRole("textbox",{name:"Item name"}),"Library camera");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");
    if(quantity!==1)fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:String(quantity)}});
    expect(screen.getByRole("textbox",{name:quantity>1 ? /Tag prefix/ : /Asset tag/})).not.toBeRequired();
    vi.mocked(createResourceItem).mockImplementation((_school,body)=>Promise.resolve(resourceFixtureItemCreation(body.command_id,body.quantity)));
    await user.click(screen.getByRole("button",{name:quantity>1 ? `Add ${quantity} copies` : "Add item"}));await waitFor(()=>expect(f.onCreated).toHaveBeenCalledOnce());
    const body=vi.mocked(createResourceItem).mock.calls[0]![1];expect(body.quantity).toBe(quantity);expect(body).not.toHaveProperty("asset_tag");
    expect(f.onCreated.mock.calls[0]![0].created_items).toHaveLength(quantity);expect(f.onCreated.mock.calls[0]![0].id).toBe(body.command_id);
  });
  it("retries an uncertain ten-copy action with the same command and quantity, not ten fresh identities",async()=>{
    const f=mountItem(),user=userEvent.setup();await user.type(screen.getByRole("textbox",{name:"Item name"}),"Workshop camera");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:"10"}});
    let retained:ResourceItemCreation|null=null;
    vi.mocked(createResourceItem).mockImplementationOnce((_school,body)=>{retained=resourceFixtureItemCreation(body.command_id,body.quantity);return Promise.reject(new TypeError("Response lost"));}).mockImplementationOnce(()=>Promise.resolve(retained!));
    await user.click(screen.getByRole("button",{name:"Add 10 copies"}));await screen.findByRole("button",{name:"Retry same action"});expect(screen.getByRole("spinbutton",{name:"Quantity"})).toBeDisabled();expect(screen.getByRole("button",{name:"Close"})).toBeDisabled();expect(f.onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button",{name:"Retry same action"}));await waitFor(()=>expect(f.onCreated).toHaveBeenCalledOnce());
    const calls=vi.mocked(createResourceItem).mock.calls;expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect(calls[0]![1].quantity).toBe(10);
    expect(Object.keys(calls[0]![1]).sort()).toEqual(["campus_id","command_id","name","quantity"]);expect(new Set(f.onCreated.mock.calls[0]![0].created_items.map(item=>item.id)).size).toBe(10);
  });
  it("refreshes a saved batch without creating any additional copies",async()=>{
    const f=mountItem(),user=userEvent.setup();f.refresh.mockRejectedValueOnce(new Error("Read failed"));await user.type(screen.getByRole("textbox",{name:"Item name"}),"Camera");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:"10"}});
    vi.mocked(createResourceItem).mockImplementation((_school,body)=>Promise.resolve(resourceFixtureItemCreation(body.command_id,body.quantity)));
    await user.click(screen.getByRole("button",{name:"Add 10 copies"}));await screen.findByRole("button",{name:"Refresh saved record"});expect(f.onCreated).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button",{name:"Refresh saved record"}));await waitFor(()=>expect(f.onCreated).toHaveBeenCalledOnce());expect(createResourceItem).toHaveBeenCalledOnce();expect(f.refresh).toHaveBeenCalledTimes(2);expect(f.onCreated.mock.calls[0]![0].created_items).toHaveLength(10);
  });
  it.each(["0","101","1.5",""])("refuses invalid quantity '%s' before posting",async quantity=>{
    mountItem();const user=userEvent.setup();await user.type(screen.getByRole("textbox",{name:"Item name"}),"Camera");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:quantity}});
    expect(screen.getByRole("button",{name:/^Add (item|\d+ copies)$/})).toBeDisabled();fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);expect(createResourceItem).not.toHaveBeenCalled();
  });
  it.each(["count","identities","anchor"] as const)("holds an incomplete %s confirmation instead of handing off invented copies",async defect=>{
    const f=mountItem(),user=userEvent.setup();await user.type(screen.getByRole("textbox",{name:"Item name"}),"Camera");await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");fireEvent.change(screen.getByRole("spinbutton",{name:"Quantity"}),{target:{value:"10"}});
    vi.mocked(createResourceItem).mockImplementation((_school,body)=>{
      const result=resourceFixtureItemCreation(body.command_id,body.quantity);
      if(defect==="count")result.created_items=result.created_items.slice(1);
      if(defect==="identities")result.created_items[1]={...result.created_items[1]!,id:body.command_id};
      if(defect==="anchor")result.id="different-command";
      return Promise.resolve(result);
    });
    await user.click(screen.getByRole("button",{name:"Add 10 copies"}));await screen.findByRole("button",{name:"Retry same action"});expect(f.onCreated).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Close"})).toBeDisabled();expect(createResourceItem).toHaveBeenCalledOnce();
  });
});
describe("explicit existing topology reuse",()=>{
  it("does not create or silently pick a campus on mount",()=>{
    mountItem();expect(createCampus).not.toHaveBeenCalled();expect(createResourceItem).not.toHaveBeenCalled();expect(screen.getByRole("combobox",{name:"Campus"})).toHaveValue("");expect(screen.queryByRole("button",{name:"Create campus"})).not.toBeInTheDocument();
  });
  it("creates only a confirmed missing first campus before adding its exact item",async()=>{
    const f=mountItem({campuses:[]}),user=userEvent.setup();expect(createCampus).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox",{name:"Item name"}),"Library book");await user.type(screen.getByRole("textbox",{name:/Asset tag/}),"BOOK-01");await user.type(screen.getByRole("textbox",{name:"Campus name"}),"Riverview");await user.type(screen.getByRole("textbox",{name:"Code"}),"RV");
    expect(screen.getByRole("button",{name:"Create campus"})).toBeDisabled();await user.click(screen.getByRole("checkbox",{name:/Create this campus/}));vi.mocked(createCampus).mockResolvedValue({id:"accepted-campus",name:"Riverview"} as Awaited<ReturnType<typeof createCampus>>);
    await user.click(screen.getByRole("button",{name:"Create campus"}));await waitFor(()=>expect(screen.getByRole("combobox",{name:"Campus"})).toHaveValue("accepted-campus"));
    vi.mocked(createResourceItem).mockImplementation((_school,body)=>Promise.resolve(resourceFixtureItemCreation(body.command_id,body.quantity,{campus_id:body.campus_id})));await user.click(screen.getByRole("button",{name:"Add item"}));await waitFor(()=>expect(f.onCreated).toHaveBeenCalledOnce());
    expect(createCampus).toHaveBeenCalledOnce();expect(createResourceItem).toHaveBeenCalledWith("school",expect.objectContaining({campus_id:"accepted-campus",name:"Library book",asset_tag:"BOOK-01"}));
  });
  it("holds an uncertain first-campus creation without automatic repetition or name matching",async()=>{
    mountItem({campuses:[]});const user=userEvent.setup();await user.type(screen.getByRole("textbox",{name:"Campus name"}),"Riverview");await user.type(screen.getByRole("textbox",{name:"Code"}),"RV");await user.click(screen.getByRole("checkbox",{name:/Create this campus/}));vi.mocked(createCampus).mockRejectedValue(new TypeError("Response lost"));
    await user.click(screen.getByRole("button",{name:"Create campus"}));await screen.findByText(/campus result is not confirmed/);expect(screen.getByRole("button",{name:"Close"})).toBeDisabled();expect(screen.queryByRole("button",{name:"Create campus"})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Refresh campus list"}));await screen.findByRole("combobox",{name:"Campus"});expect(screen.getByRole("combobox",{name:"Campus"})).toHaveValue("");expect(createCampus).toHaveBeenCalledOnce();expect(createResourceItem).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByRole("combobox",{name:"Campus"}),"campus-1");await user.click(screen.getByRole("button",{name:"Continue with selected campus"}));expect(screen.getByRole("button",{name:"Close"})).toBeEnabled();expect(createCampus).toHaveBeenCalledOnce();
  });
});
