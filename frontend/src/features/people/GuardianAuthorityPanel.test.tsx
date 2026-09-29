import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {afterEach,describe,it,expect,vi} from "vitest";
import {GuardianAuthorityPanel} from "./GuardianAuthorityPanel";
import {changeGuardianAuthority,getGuardianAuthority,type GuardianAuthority} from "./api";
vi.mock("./api",()=>({changeGuardianAuthority:vi.fn(),getGuardianAuthority:vi.fn()}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
const detail:GuardianAuthority={id:"relationship-1",student_id:"student-1",student_name:"Ishaan Deshmukh",guardian_name:"Nandita Deshmukh",revision:1,enabled:true,valid_from:null,valid_until:null,source:"legacy",effective:true,today:"2026-09-15",history:[]};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.mocked(getGuardianAuthority).mockResolvedValue(detail);render(<QueryClientProvider client={client}><GuardianAuthorityPanel schoolId="school-1" id={detail.id} onClose={vi.fn()}/></QueryClientProvider>);return client;}
async function openReview(){const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"Review permission"}));await user.selectOptions(screen.getByLabelText("Leave-signing permission"),"revoke");await user.type(screen.getByLabelText("Reason for change"),"School verified that this permission should be revoked.");await user.click(screen.getByRole("button",{name:"Review change"}));return user;}
describe("Guardian leave-signing permissions",()=>{
  it("requires review and verified confirmation before revoking authority",async()=>{
    mount();const user=await openReview();expect(changeGuardianAuthority).not.toHaveBeenCalled();expect(screen.getByRole("button",{name:"Confirm permission"})).toBeDisabled();
    expect(screen.getByText(/New signatures will be blocked/)).toBeVisible();
    vi.mocked(changeGuardianAuthority).mockResolvedValue({...detail,revision:2,enabled:false});
    await user.click(screen.getByLabelText("I have verified this guardian's leave-signing authority with the school."));
    await user.click(screen.getByRole("button",{name:"Confirm permission"}));
    expect(changeGuardianAuthority).toHaveBeenCalledWith(detail.id,expect.objectContaining({expected_revision:1,enabled:false,valid_from:null,valid_until:null,verified:true}));
    expect(await screen.findByRole("status")).toHaveTextContent("Permission updated");
  });
  it("retries the same command key after a lost response",async()=>{
    const client=mount();const user=await openReview();vi.mocked(changeGuardianAuthority).mockRejectedValueOnce(new Error("Connection interrupted")).mockResolvedValueOnce({...detail,revision:2});
    await user.click(screen.getByRole("checkbox"));await user.click(screen.getByRole("button",{name:"Confirm permission"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    client.setQueryData(["school","people","authority","school-1",detail.id],{...detail,revision:2,enabled:false,effective:false});
    await user.click(await screen.findByRole("button",{name:"Retry same save"}));
    await waitFor(()=>expect(changeGuardianAuthority).toHaveBeenCalledTimes(2));
    expect(vi.mocked(changeGuardianAuthority).mock.calls[0]).toEqual(vi.mocked(changeGuardianAuthority).mock.calls[1]);
  });
  it("does not silently replace an edited form when a newer revision arrives",async()=>{
    const client=mount();await openReview();client.setQueryData(["school","people","authority","school-1",detail.id],{...detail,revision:2});
    expect(await screen.findByRole("alert")).toHaveTextContent("changed while you were editing");expect(screen.getByRole("button",{name:"Confirm permission"})).toBeDisabled();expect(changeGuardianAuthority).not.toHaveBeenCalled();
  });
  it("supports date bounds, keyboard focus and cancellation without saving",async()=>{
    mount();const user=userEvent.setup();await user.click(await screen.findByRole("button",{name:"Review permission"}));
    expect(screen.getByRole("heading",{name:"Update leave-signing permission"})).toHaveFocus();
    expect(screen.getByLabelText("Valid from")).toHaveValue("2026-09-15");fireEvent.change(screen.getByLabelText("Valid through (optional)"),{target:{value:"2026-12-31"}});
    await user.click(screen.getByRole("button",{name:"Cancel"}));expect(changeGuardianAuthority).not.toHaveBeenCalled();expect(screen.queryByLabelText("Valid from")).not.toBeInTheDocument();
  });
  it("offers retry when permission records cannot load",async()=>{
    mount();vi.mocked(getGuardianAuthority).mockRejectedValue(new Error("Unavailable"));
    // A fresh cache isolates the failure from the previous successful request.
    cleanup();render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><GuardianAuthorityPanel schoolId="school-1" id="missing" onClose={vi.fn()}/></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("Permissions could not load");expect(screen.getByRole("button",{name:"Try again"})).toBeEnabled();
  });
});
