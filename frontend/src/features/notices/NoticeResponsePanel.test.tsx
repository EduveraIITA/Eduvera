import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { respondToNotice, type NoticeDetail, type NoticeRecipient } from "./api";
import { NoticeResponsePanel } from "./NoticeResponsePanel";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, respondToNotice: vi.fn().mockResolvedValue({}) };
});

const recipient: NoticeRecipient = {
  id: "recipient-1", recipient_role: "guardian", user_id: "parent-1", guardian_id: "guardian-1", student_id: "student-1",
  recipient_name: "Pooja Sharma", contact_phone: "", contact_email: "", opened_at: null, responded_at: null,
  response_value: null, response_note: "", response_channel: null, response_observed_at: null, revision: 3,
  last_seen_notice_revision: 0, deliveries: [],
};
const notice: NoticeDetail = {
  id: "notice-1", title: "Trip timing", body: "Choose the suitable time.", response_mode: "choice", response_options: ["8:00 AM", "8:30 AM"],
  priority: "normal", due_at: "2099-10-15T10:00:00.000Z", status: "published", revision: 2,
  published_at: "2099-10-10T10:00:00.000Z", cancelled_at: null, cancellation_reason: "", created_at: "2099-10-09T10:00:00.000Z",
  audiences: [], can_manage: false, recipient,
};

function show(value: NoticeDetail = notice, row: NoticeRecipient = recipient) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const saved = vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={client}><NoticeResponsePanel notice={value} recipient={row} studentId="student-1" onSaved={saved} /></QueryClientProvider>);
  return { saved };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("NoticeResponsePanel", () => {
  it("submits the selected response against the snapshotted recipient revision", async () => {
    const user = userEvent.setup(); const { saved } = show();
    await user.click(screen.getByRole("radio", { name: "8:30 AM" }));
    await user.click(screen.getByRole("button", { name: "Submit response" }));
    expect(vi.mocked(respondToNotice)).toHaveBeenCalledWith("notice-1", {
      expected_revision: 3, response_value: "8:30 AM", student_id: "student-1",
    }, expect.any(String));
    expect(saved).toHaveBeenCalledOnce();
  });

  it("does not ask for a response to information-only notices", () => {
    show({ ...notice, response_mode: "information", response_options: [], due_at: null });
    expect(screen.getByText("No response needed")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an already recorded choice without another action", () => {
    show(notice, { ...recipient, responded_at: "2099-10-11T08:00:00.000Z", response_value: "8:00 AM", response_channel: "phone" });
    expect(screen.getByText("8:00 AM")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Submit response" })).not.toBeInTheDocument();
  });
});
