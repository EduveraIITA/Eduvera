import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { RequestInboxView } from "./RequestInboxPage";
import type { RequestInboxItem, RequestInboxResponse } from "./api";

function item(id: string, priority: RequestInboxItem["priority"], category: RequestInboxItem["category"], title: string): RequestInboxItem {
  return { id, kind: id, category, priority, title, detail: `${title} details`, status_label: "Response needed", action_label: "Review", href: `/parent/${id}`, source_id: id, subject_label: "Aarav Sharma", occurs_at: null, due_at: "2026-10-15T12:00:00.000Z", created_at: null };
}

function LocationProbe() {
  const location = useLocation();
  const returnTo = (location.state as { portalReturnTo?: unknown } | null)?.portalReturnTo;
  return <><output data-testid="location">{location.pathname}{location.search}</output><output data-testid="return-to">{typeof returnTo === "string" ? returnTo : ""}</output></>;
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
    expect(screen.getByRole("link", { name: /Pickup change/ })).toHaveAttribute("href", "/parent/urgent");
    expect(screen.queryByText("One place for decisions, responses and acknowledgements.")).not.toBeInTheDocument();
  });

  it("filters without hiding the total workload", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/parent/requests?student_id=student"]}><RequestInboxView data={data} /><LocationProbe /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Policies 1" }));
    expect(screen.getByText("Policy acknowledgement")).toBeVisible();
    expect(screen.queryByText("Pickup change")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All 3" })).toBeVisible();
    expect(screen.getByTestId("location")).toHaveTextContent("/parent/requests?student_id=student&category=governance");
  });

  it("carries the filtered inbox as explicit return provenance", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/parent/requests?student_id=student&category=transport"]}>
        <Routes>
          <Route path="/parent/requests" element={<RequestInboxView data={data} />} />
          <Route path="/parent/:request" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("link", { name: /Pickup change/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("/parent/urgent");
    expect(screen.getByTestId("return-to")).toHaveTextContent("/parent/requests?student_id=student&category=transport");
  });

  it("opens staff leave decisions through the role-neutral action route", () => {
    const leave: RequestInboxItem = {
      ...item("staff-leave", "high", "leave", "Kavita Mehta · Casual leave"),
      kind: "staff_leave_review",
      source_id: "10000000-0000-4000-a000-000000000001",
      href: "/work/staff-leave?school=school-1&request=10000000-0000-4000-a000-000000000001",
    };
    const teacherData: RequestInboxResponse = {
      ...data,
      portal: "teacher",
      summary: { total: 1, urgent: 0, high: 1, normal: 0, categories: { leave: 1 } },
      items: [leave],
    };

    render(<MemoryRouter><RequestInboxView data={teacherData} /></MemoryRouter>);

    expect(screen.getByRole("link", { name: /Kavita Mehta/ })).toHaveAttribute(
      "href",
      "/work/staff-leave?school=school-1&request=10000000-0000-4000-a000-000000000001&context=teacher",
    );
  });

  it("opens an invigilation request in the existing assessment duty workspace", () => {
    const invigilation: RequestInboxItem = {
      ...item("invigilation-offer", "high", "academics", "Mathematics mid-term"),
      kind: "assessment_invigilation",
      source_id: "10000000-0000-4000-a000-000000000001",
      status_label: "Invigilation response needed",
      action_label: "Review duty",
      href: "/teacher/assessments?assessment=20000000-0000-4000-a000-000000000002",
      subject_label: "Mathematics",
    };
    const teacherData: RequestInboxResponse = {
      ...data,
      portal: "teacher",
      summary: { total: 1, urgent: 0, high: 1, normal: 0, categories: { academics: 1 } },
      items: [invigilation],
    };

    render(<MemoryRouter><RequestInboxView data={teacherData} /></MemoryRouter>);

    const link = screen.getByRole("link", { name: /Mathematics mid-term/ });
    expect(link).toHaveAttribute("href", "/teacher/assessments?assessment=20000000-0000-4000-a000-000000000002");
    expect(screen.getByText("Invigilation response needed")).toBeVisible();
    expect(screen.getByText("Review duty")).toBeVisible();
  });
});
