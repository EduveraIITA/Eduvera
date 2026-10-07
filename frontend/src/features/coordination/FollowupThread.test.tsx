import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FollowupThread } from "./FollowupThread";
import { addFollowupEntry, getFollowup } from "./api";

vi.mock("./api", () => ({ getFollowup: vi.fn(), addFollowupEntry: vi.fn() }));
afterEach(cleanup);
const detail = { id: "follow-up-1", student_id: "student-1", student_name: "Aarav Sharma", owner_name: "Kavita Mehta", attendance_date: "2026-09-11", question: "Please clarify the absence.", due_at: "2026-09-16T12:00:00Z", state: "awaiting_response" as const, revision: 1, outcome: null, updated_at: "2026-09-15T10:00:00Z", created_at: "2026-09-15T10:00:00Z", overdue: false, guardians: [{ id: "guardian-1", name: "Pooja Sharma" }], entries: [] };
function mount(context: "staff" | "guardian", canResolve = context === "staff") {
  vi.mocked(getFollowup).mockResolvedValue({ ...detail, can_resolve: canResolve });
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><FollowupThread id={detail.id} context={context} /></QueryClientProvider>);
}
describe("Attendance follow-up UI", () => {
  it("offers a guardian response without resolution or staff attribution controls", async () => {
    mount("guardian");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your response"), "We had a family appointment.");
    vi.mocked(addFollowupEntry).mockResolvedValue({ id: detail.id, revision: 2 });
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(addFollowupEntry).toHaveBeenCalledWith(detail.id, expect.objectContaining({ context: "guardian", kind: "guardian_reply", expected_revision: 1 }));
    expect(screen.queryByLabelText("Next action")).not.toBeInTheDocument();
  });
  it("keeps the same operation ID and text after a failed send", async () => {
    mount("guardian"); const user = userEvent.setup();
    vi.mocked(addFollowupEntry).mockRejectedValue(new Error("Connection interrupted"));
    await user.type(await screen.findByLabelText("Your response"), "A family appointment.");
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByLabelText("Your response")).toHaveValue("A family appointment.");
    const first = vi.mocked(addFollowupEntry).mock.calls.at(-1)![1].idempotency_key;
    await user.click(screen.getByRole("button", { name: "Send response" }));
    expect(vi.mocked(addFollowupEntry).mock.calls.at(-1)![1].idempotency_key).toBe(first);
  });
  it("requires staff to identify a guardian and the non-app response channel", async () => {
    mount("staff");
    expect(await screen.findByLabelText("Guardian")).toHaveValue("guardian-1");
    expect(screen.getByLabelText("Contact method")).toHaveValue("phone");
    expect(screen.getByLabelText("Response received at")).toBeRequired();
    expect(screen.getByRole("button", { name: "Save response" })).toBeDisabled();
  });
  it("does not offer resolution to staff who do not own the follow-up", async () => {
    mount("staff", false);
    expect(await screen.findByLabelText("Guardian")).toHaveValue("guardian-1");
    expect(screen.queryByLabelText("Next action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Record outcome & resolve" })).not.toBeInTheDocument();
  });
});
