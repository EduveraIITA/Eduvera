import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { MemberEditor } from "./AdministrationPage";
import type { Member } from "./api";

afterEach(cleanup);
const member:Member={id:"membership-1",user_id:"teacher-1",first_name:"Kavita",last_name:"Mehta",email:"kavita@school.test",role:"staff",is_active:true};

describe("school member administration",()=>{
  it("edits membership without exposing raw capability switches",async()=>{
    const onSave=vi.fn().mockResolvedValue(undefined);const user=userEvent.setup();
    render(<MemoryRouter><MemberEditor member={member} onCancel={vi.fn()} onSave={onSave}/></MemoryRouter>);
    const dialog=screen.getByRole("dialog",{name:"Manage Kavita Mehta"});
    expect(within(dialog).getByRole("heading",{name:"Manage Kavita Mehta"})).toHaveFocus();
    expect(within(dialog).getByText("kavita@school.test")).toBeVisible();
    expect(within(dialog).queryByRole("checkbox",{name:"Manage fees"})).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link",{name:"Manage staff role"})).toHaveAttribute("href","/principal/staff");
    await user.click(within(dialog).getByRole("button",{name:"Save membership"}));
    expect(onSave).toHaveBeenCalledWith({is_active:true});
  });

  it("closes safely with Escape before making a change",async()=>{
    const onCancel=vi.fn();const user=userEvent.setup();
    render(<MemoryRouter><MemberEditor member={member} onCancel={onCancel} onSave={vi.fn()}/></MemoryRouter>);
    await user.keyboard("{Escape}");expect(onCancel).toHaveBeenCalledOnce();
  });
});
