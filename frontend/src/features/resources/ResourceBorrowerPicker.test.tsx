import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { getParticipant, listParticipants } from "../people/participationApi";
import { ResourceBorrowerPicker } from "./ResourceBorrowerPicker";
import { getResourceOptions } from "./resourceApi";
import { resourceFixtureOptions } from "./resources.test-fixtures";

vi.mock("../people/participationApi",()=>({listParticipants:vi.fn(),getParticipant:vi.fn()}));
vi.mock("./resourceApi",()=>({getResourceOptions:vi.fn()}));
vi.mock("../people/PeopleBulkAddDialog",()=>({PeopleBulkAddDialog:({onDone}:{onDone:(people:{id:string}[])=>void})=><div role="dialog" aria-label="Add people"><button onClick={()=>onDone([{id:"new-a"},{id:"new-b"}])}>Add two names</button></div>}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(canAddPeople=true){
  vi.mocked(getResourceOptions).mockResolvedValue(resourceFixtureOptions({people:[{id:"person-a",label:"Sana Patel",revision:2}],can_add_people:canAddPeople}));
  const onSelected=vi.fn(),onClose=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceBorrowerPicker schoolId="campus" actorId="actor" initial={null} onSelected={onSelected} onClose={onClose} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return {onSelected,onClose};
}
describe("exact resource borrower choice",()=>{
  it("allows a passive person, with no automatic first-person choice and a fresh canonical revision",async()=>{
    const f=mount(),user=userEvent.setup();
    expect(screen.getByRole("button",{name:"Use borrower"})).toBeDisabled();
    await user.click(await screen.findByRole("radio",{name:/Sana Patel/}));
    vi.mocked(getResourceOptions).mockResolvedValueOnce(resourceFixtureOptions({people:[{id:"person-a",label:"Sana Patel",revision:7}]}));
    await user.click(screen.getByRole("button",{name:"Use borrower"}));
    await waitFor(()=>expect(f.onSelected).toHaveBeenCalledWith({id:"person-a",name:"Sana Patel",revision:7}));
    expect(getResourceOptions).toHaveBeenLastCalledWith("campus",{person_id:"person-a"});expect(listParticipants).not.toHaveBeenCalled();expect(getParticipant).not.toHaveBeenCalled();
  });
  it("does not pick the first person after a multiple-name quick add",async()=>{
    const f=mount(),user=userEvent.setup();await screen.findByText("Sana Patel");
    await user.click(screen.getByRole("button",{name:"Add people"}));await user.click(screen.getByRole("button",{name:"Add two names"}));
    expect(screen.getByRole("status")).toHaveTextContent("2 people added. Choose the borrower");
    expect(screen.getByRole("button",{name:"Use borrower"})).toBeDisabled();expect(f.onSelected).not.toHaveBeenCalled();
  });
  it("lets a Resources-only custodian select without SIS access and hides unauthorized quick add",async()=>{
    const f=mount(false),user=userEvent.setup();await user.click(await screen.findByRole("radio",{name:/Sana Patel/}));
    expect(screen.queryByRole("button",{name:"Add people"})).not.toBeInTheDocument();expect(screen.getByText("Your People manager can add someone new.")).toBeVisible();
    await user.click(screen.getByRole("button",{name:"Use borrower"}));await waitFor(()=>expect(f.onSelected).toHaveBeenCalledOnce());expect(listParticipants).not.toHaveBeenCalled();expect(getParticipant).not.toHaveBeenCalled();
  });
});
