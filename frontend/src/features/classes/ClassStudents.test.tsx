import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClassStudents } from "./ClassStudents";
import type { TeacherRosterStudent } from "../operations/api";

const roster: TeacherRosterStudent[] = [{ id: "1", name: "Ananya Iyer", roll_number: 1, admission_number: "CIS-001", avatar_url: "", status: "half_day", remarks: "", attendance_id: null, updated_at: null }, { id: "2", name: "Aarav Sharma", roll_number: 2, admission_number: "CIS-002", avatar_url: "", status: null, remarks: "", attendance_id: null, updated_at: null }];
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("switches layouts, retains search and remembers the preference on remount", async () => {
  const user = userEvent.setup(); const view = render(<ClassStudents roster={roster} />);
  expect(screen.getByRole("button", { name: "List view" })).toHaveAttribute("aria-pressed", "true");
  await user.type(screen.getByRole("searchbox"), "CIS-001");
  await user.click(screen.getByRole("button", { name: "Gallery view" }));
  expect(screen.getByRole("list")).toHaveClass("classes-gallery");
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(1);
  expect(screen.getByText("Half day")).toBeVisible();
  view.unmount(); render(<ClassStudents roster={roster} />);
  expect(screen.getByRole("button", { name: "Gallery view" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Not marked")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "List view" }));
  expect(screen.getByRole("list")).toHaveClass("classes-list");
});
it("works with keyboard and when storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("disabled"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
  const user = userEvent.setup(); render(<ClassStudents roster={roster} />);
  screen.getByRole("button", { name: "Gallery view" }).focus(); await user.keyboard("{Enter}");
  expect(screen.getByRole("list")).toHaveClass("classes-gallery");
});
