import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RequestInboxView } from "./RequestInboxPage";
import type { RequestInboxItem, RequestInboxResponse } from "./api";

function item(id: string, priority: RequestInboxItem["priority"], category: RequestInboxItem["category"], title: string): RequestInboxItem {
  return { id, kind: id, category, priority, title, detail: `${title} details`, status_label: "Response needed", action_label: "Review", href: `/${id}`, source_id: id, subject_label: "Aarav Sharma", occurs_at: null, due_at: "2026-10-15T12:00:00.000Z", created_at: null };
}

const data: RequestInboxResponse = {
  portal: "parent",
  generated_at: "2026-10-13T00:00:00.000Z",
  scope: { school_id: "school", school_name: "Cambridge International School", timezone: "Asia/Kolkata", student_id: "student", student_name: "Aarav Sharma" },
  summary: { total: 3, urgent: 1, high: 1, normal: 1, categories: { transport: 2, governance: 1 } },
  items: [
    item("urgent", "urgent", "transport", "Pickup change"),
    item("high", "high", "transport", "Bus duty response"),
    item("normal", "normal", "governance", "Policy acknowledgement"),
  ],
};

afterEach(cleanup);

describe("RequestInboxView", () => {
  it("shows a semantic priority stack with clear workflow links", () => {
    render(<MemoryRouter><RequestInboxView data={data} /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Urgent" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Later" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pickup change/ })).toHaveAttribute("href", "/urgent");
    expect(screen.queryByText("One place for decisions, responses and acknowledgements.")).not.toBeInTheDocument();
  });

  it("filters without hiding the total workload", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><RequestInboxView data={data} /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Policies 1" }));
    expect(screen.getByText("Policy acknowledgement")).toBeVisible();
    expect(screen.queryByText("Pickup change")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All 3" })).toBeVisible();
  });
});
