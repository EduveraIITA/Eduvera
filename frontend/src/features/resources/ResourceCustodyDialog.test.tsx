import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ResourceCustodyDialog } from "./ResourceCustodyDialog";
import { changeResourceCustodian, confirmResourceCommand, getResourceCustodians } from "./resourceApi";
import { resourceFixtureLoan } from "./resources.test-fixtures";

vi.mock("./resourceApi",()=>({changeResourceCustodian:vi.fn(),confirmResourceCommand:vi.fn(),getResourceCustodians:vi.fn(),getResourceLoan:vi.fn()}));
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.setAttribute("open","");};HTMLDialogElement.prototype.close=function(){this.removeAttribute("open");};});
afterEach(()=>{cleanup();vi.clearAllMocks();});
function mount(refresh=vi.fn().mockResolvedValue(undefined),recovery=false){
  vi.mocked(getResourceCustodians).mockResolvedValue({people:[{id:"successor",label:"Farah Khan"}],recovery,pagination:{page:1,page_size:10,total:1}});
  const onClose=vi.fn();
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ExecutionEnvironmentProvider environment={{mode:"live"}}><MemoryRouter><ResourceCustodyDialog schoolId="school" loan={resourceFixtureLoan({can_change_custodian:true,custody_recovery:recovery})} refresh={refresh} onClose={onClose} /></MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return {onClose,refresh};
}
describe("resource responsibility handover",()=>{
  it("asks only for the exact eligible successor and reason, never preselecting a person or recording return",async()=>{
    const f=mount(),user=userEvent.setup();vi.mocked(changeResourceCustodian).mockResolvedValue(resourceFixtureLoan());
    expect(screen.getByRole("button",{name:"Save responsibility"})).toBeDisabled();
    await user.click(await screen.findByRole("radio",{name:/Farah Khan/}));await user.type(screen.getByRole("textbox",{name:"Reason"}),"Library desk handover");
    await user.click(screen.getByRole("button",{name:"Save responsibility"}));
    await waitFor(()=>expect(f.onClose).toHaveBeenCalledOnce());
    const body=vi.mocked(changeResourceCustodian).mock.calls[0]![2];expect(body.command_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body).toMatchObject({expected_revision:1,custodian_person_id:"successor",reason:"Library desk handover"});
    expect(screen.queryByRole("button",{name:"Record return"})).not.toBeInTheDocument();
  });
  it("recovers a confirmed handover after refresh failure without sending it twice",async()=>{
    const f=mount(vi.fn().mockRejectedValueOnce(new Error("Read failed")).mockResolvedValue(undefined),true),user=userEvent.setup();
    vi.mocked(changeResourceCustodian).mockResolvedValue(resourceFixtureLoan());
    expect(screen.getByText(/Their access is unavailable/)).toBeVisible();
    await user.click(await screen.findByRole("radio",{name:/Farah Khan/}));await user.type(screen.getByRole("textbox",{name:"Reason"}),"Previous custodian left campus");await user.click(screen.getByRole("button",{name:"Save responsibility"}));
    await user.click(await screen.findByRole("button",{name:"Refresh saved record"}));await waitFor(()=>expect(f.onClose).toHaveBeenCalledOnce());
    expect(changeResourceCustodian).toHaveBeenCalledOnce();expect(confirmResourceCommand).not.toHaveBeenCalled();
  });
  it("locks an unknown handover until the original signer can read its exact accepted receipt",async()=>{
    const f=mount(),user=userEvent.setup();vi.mocked(changeResourceCustodian).mockRejectedValue(new TypeError("Response lost"));vi.mocked(confirmResourceCommand).mockResolvedValue({state:"accepted",result:{id:"loan-1",revision:2}});
    await user.click(await screen.findByRole("radio",{name:/Farah Khan/}));await user.type(screen.getByRole("textbox",{name:"Reason"}),"Desk responsibility change");await user.click(screen.getByRole("button",{name:"Save responsibility"}));
    await screen.findByRole("button",{name:"Check result"});expect(screen.getByRole("textbox",{name:"Reason"})).toBeDisabled();expect(screen.getByRole("button",{name:"Close"})).toBeDisabled();
    await user.click(screen.getByRole("button",{name:"Check result"}));await waitFor(()=>expect(f.onClose).toHaveBeenCalledOnce());expect(changeResourceCustodian).toHaveBeenCalledOnce();expect(confirmResourceCommand).toHaveBeenCalledWith("school","loan-1",vi.mocked(changeResourceCustodian).mock.calls[0]![2].command_id);
  });
});
