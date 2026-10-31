import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttendanceParticipantRow } from "./AttendanceParticipantRow";

afterEach(cleanup);
const participant = { id: "person-1", name: "Ravi Kumar" };
describe("attendance participant controls", () => {
  it("marks attendance through the visible controls without a swipe wrapper", async () => {
    const onChange = vi.fn();
    render(<AttendanceParticipantRow participant={participant} status={null} remarks="" disabled={false} conflict={false} onChange={onChange} />);
    const article = screen.getByRole("article", { name: participant.name });
    expect(within(article).getByRole("button", { name: "Present", exact: true })).toBeEnabled();
    expect(within(article).getByRole("button", { name: "Absent", exact: true })).toBeEnabled();
    expect(within(article).getByRole("combobox", { name: `Attendance status for ${participant.name}` })).toHaveValue("");
    expect(article.parentElement).not.toHaveClass("swipe-actions");
    expect(screen.queryByRole("button", { name: /Quick actions/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(article).getByRole("button", { name: "Present", exact: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: "present" });
    onChange.mockClear();
    await userEvent.click(within(article).getByRole("button", { name: "Absent", exact: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: "absent" });
  });

  it("disables the native controls when recording becomes disabled", async () => {
    const onChange = vi.fn(), props = { participant, status: null, remarks: "", conflict: false, onChange };
    const view = render(<AttendanceParticipantRow {...props} disabled={false} />);
    view.rerender(<AttendanceParticipantRow {...props} disabled />);
    const current = screen.getByRole("article", { name: participant.name });
    expect(within(current).getByRole("button", { name: "Present", exact: true })).toBeDisabled();
    expect(within(current).getByRole("button", { name: "Absent", exact: true })).toBeDisabled();
    expect(within(current).getByRole("combobox", { name: `Attendance status for ${participant.name}` })).toBeDisabled();
    await userEvent.click(within(current).getByRole("button", { name: "Absent", exact: true }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the owning context's Present and No-show choices without inventing Absent", async () => {
    const onChange = vi.fn();
    render(<AttendanceParticipantRow<"present" | "no_show"> participant={participant} status={null} remarks="" disabled={false} conflict={false}
      statusOptions={[{ value: "present", label: "Present" }, { value: "no_show", label: "No-show" }]}
      quickStatuses={[{ value: "present", label: "Present" }, { value: "no_show", label: "No-show" }]} onChange={onChange} />);
    const article = screen.getByRole("article", { name: participant.name });
    expect(screen.queryByRole("button", { name: /^Absent\b/ })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(article).getByRole("button", { name: "No-show", exact: true }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ status: "no_show" });
  });
});
