import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberEditor } from "./AdministrationPage";
import type { Member } from "./api";

afterEach(cleanup);

const member: Member = {
  id: "membership-1",
  user_id: "teacher-1",
  first_name: "Kavita",
  last_name: "Mehta",
  email: "kavita@school.test",
  role: "staff",
  is_active: true,
};

describe("school member administration", () => {
  it("opens access editing as a focused sheet and submits the complete permission state", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<MemberEditor member={member} grants={["sis.manage"]} onCancel={vi.fn()} onSave={onSave} />);

    const dialog = screen.getByRole("dialog", { name: "Manage Kavita Mehta" });
    expect(within(dialog).getByRole("heading", { name: "Manage Kavita Mehta" })).toHaveFocus();
    expect(within(dialog).getByText("kavita@school.test")).toBeVisible();
    expect(within(dialog).getByRole("checkbox", { name: "Manage school records" })).toBeChecked();
    await user.click(within(dialog).getByRole("checkbox", { name: "Manage fees" }));
    await user.click(within(dialog).getByRole("button", { name: "Save access" }));

    expect(onSave).toHaveBeenCalledWith({ is_active: true, permissions: ["sis.manage", "fees.manage"] });
  });

  it("closes safely with Escape before making a change", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<MemberEditor member={member} grants={[]} onCancel={onCancel} onSave={vi.fn()} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
