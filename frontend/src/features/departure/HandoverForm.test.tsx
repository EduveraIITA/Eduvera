import { cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import { afterEach,describe,expect,it,vi } from "vitest";
import type { AdminDeparture } from "./api";
import { HandoverForm } from "./HandoverForm";
afterEach(cleanup);
const plan={id:"plan",mode:"guardian_pickup",revision:4,collector_name:"Approved Guardian"} as AdminDeparture["plans"][number];
describe("factual handover",()=>{
  it("requires an explicit outcome with entered evidence and the reviewed revision",async()=>{
    const save=vi.fn().mockResolvedValue({});render(<HandoverForm plan={plan} pending={false} onSave={save}/>);
    fireEvent.click(screen.getByRole("button",{name:"Record handover"}));expect(screen.getByText(/Approved receiver/)).toBeVisible();expect(screen.getByRole("button",{name:"Confirm outcome"})).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Verification record"),{target:{value:"Guardian photo matched school record"}});
    fireEvent.click(screen.getByRole("button",{name:"Confirm outcome"}));await waitFor(()=>expect(save).toHaveBeenCalledWith(expect.objectContaining({expected_revision:4,note:"Guardian photo matched school record",outcome:"handed_over"})));
  });
  it("retains evidence on a failed save",async()=>{
    const save=vi.fn().mockRejectedValue(new Error("Offline"));render(<HandoverForm plan={plan} pending={false} onSave={save}/>);
    fireEvent.click(screen.getByRole("button",{name:"Record handover"}));const evidence=screen.getByLabelText("Verification record");fireEvent.change(evidence,{target:{value:"Receiver arrived"}});
    fireEvent.click(screen.getByRole("button",{name:"Confirm outcome"}));await waitFor(()=>expect(save).toHaveBeenCalled());expect(evidence).toHaveValue("Receiver arrived");
  });
});
