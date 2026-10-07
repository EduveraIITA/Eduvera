import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProfile, type ProfileDuty, type WorkProfileTemplate } from "./api";
import { RoleEditor } from "./RoleEditor";

vi.mock("./api", async (importOriginal) => ({ ...(await importOriginal<typeof import("./api")>()), saveProfile: vi.fn() }));

const duties:ProfileDuty[]=[
  {id:"duty-class",code:"class_teacher",name:"Class teacher",category:"academic",scope_kind:"class_section",description:"Own a class section.",access_summary:"Assigned class attendance and family coordination.",requires_acceptance:false,restricted:false},
  {id:"duty-transport",code:"transport_attendant",name:"Transport attendant",category:"operations",scope_kind:"scheduled_duty",description:"Operate an assigned trip.",access_summary:"Assigned journeys and riders.",requires_acceptance:true,restricted:true},
];
const templates:WorkProfileTemplate[]=[{key:"teaching",name:"Teaching staff",description:"Teaching responsibilities.",duty_codes:["class_teacher"]}];

afterEach(()=>{cleanup();vi.clearAllMocks();});
beforeEach(()=>{vi.mocked(saveProfile).mockResolvedValue({} as never);});

describe("RoleEditor",()=>{
  it("starts from a template and saves only eligibility",async()=>{
    const user=userEvent.setup();const saved=vi.fn().mockResolvedValue(undefined);
    render(<RoleEditor school="school" profile={null} templates={templates} duties={duties} onSaved={saved} onCancel={vi.fn()}/>);
    await user.click(screen.getByRole("button",{name:/Teaching staff/}));
    expect(screen.getByLabelText(/Class teacher/)).toBeChecked();
    await user.click(screen.getByRole("button",{name:"Save role"}));
    expect(saveProfile).toHaveBeenCalledWith("school",{name:"Teaching staff",description:"Teaching responsibilities.",duty_ids:["duty-class"],template_key:"teaching"},undefined);
    expect(saved).toHaveBeenCalledOnce();
  });

  it("preserves selections and revision after a failed save",async()=>{
    vi.mocked(saveProfile).mockRejectedValue(new Error("This role changed. Refresh before saving."));
    const user=userEvent.setup();
    render(<RoleEditor school="school" profile={{id:"profile",name:"Transport staff",description:"Journeys",template_key:"transport",system_managed:false,duty_ids:["duty-transport"],revision:4,member_count:1}} templates={templates} duties={duties} onSaved={vi.fn()} onCancel={vi.fn()}/>);
    await user.click(screen.getByRole("button",{name:"Save role"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("role changed");
    expect(screen.getByLabelText(/Transport attendant/)).toBeChecked();
    expect(saveProfile).toHaveBeenCalledWith("school",expect.objectContaining({duty_ids:["duty-transport"],expected_revision:4}),"profile");
  });
});
