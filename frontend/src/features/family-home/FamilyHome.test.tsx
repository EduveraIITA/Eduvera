import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StudentHomePage, type StudentHomeData } from "../../pages/student/StudentHomePage";

vi.mock("../../pages/student/StudentShell", () => ({ StudentShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("qrcode", () => ({ toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,identity") }));
const data: StudentHomeData = {
  studentName: "Aarav Sharma", className: "Class 7A", rollNumber: "17", studentId: "CIS-2023-071", termLabel: "Term 1", dateLabel: "Friday, 9 October",
  presence: { label: "Not recorded yet", detail: "Waiting for today's school attendance", verified: false },
  attendancePercent: 93.3, attendanceThreshold: 85, periodsToday: 1, activeLeaveCount: 1, unreadNotifications: 0,
  schedule: [{ id: "math", period: 1, subject: "Mathematics", teacher: "Kavita Mehta", room: "201", startsAt: "09:00", endsAt: "09:45", state: "upcoming", materials: ["Math notebook"] }],
  diary: [{ id: "diary", title: "Read chapter 3", detail: "Bring your reader tomorrow.", label: "English" }], homeActions: [],
};
function Location() { const location = useLocation(); return <output aria-label="Location">{location.pathname}</output>; }
function mount(value = data) { return render(<MemoryRouter><StudentHomePage data={value} /><Location /></MemoryRouter>); }
afterEach(() => { cleanup(); window.localStorage.clear(); });

describe("family home touch-up", () => {
  it("retains the identity card, activities, four summary tiles, shortcuts and diary", () => {
    const view = mount();
    expect(view.container.querySelector(".student-home-page")).toHaveClass("family-home");
    expect(screen.getByRole("button", { name: /Open digital student ID for Aarav Sharma/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Today's activities" })).toBeVisible();
    const summary = screen.getByRole("region", { name: "At a glance" });
    expect(within(summary).getAllByRole("button")).toHaveLength(4);
    expect(within(summary).getByText("93.3%")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Quick actions" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Today's diary" })).toBeVisible();
    expect(screen.getByText("Bring your reader tomorrow.")).toBeVisible();
    expect(screen.queryByText("Class desk")).not.toBeInTheDocument();
  });
  it("uses a waiting icon for unrecorded attendance, not a confirmed checkmark", () => {
    mount();
    const presence = screen.getByRole("region", { name: "Today's attendance status" });
    expect(presence).not.toHaveClass("is-verified");
    expect(presence.querySelector(".lucide-clock-3")).toBeInTheDocument();
    expect(presence.querySelector(".lucide-circle-check")).not.toBeInTheDocument();
    expect(within(presence).getByText("Not recorded yet")).toBeVisible();
    fireEvent.click(within(presence).getByRole("button", { name: "Details" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent("/student/attendance");
  });
  it("retains verified attendance and its status text", () => {
    mount({ ...data, presence: { label: "Present", detail: "Recorded by your teacher", verified: true } });
    const presence = screen.getByRole("region", { name: "Today's attendance status" });
    expect(presence).toHaveClass("is-verified");
    expect(presence.querySelector(".lucide-circle-check")).toBeInTheDocument();
    expect(within(presence).getByText("Present")).toBeVisible();
  });
  it("retains packing, the schedule sheet and the existing timetable route", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Today checklist/ }));
    const checklist = screen.getByRole("dialog", { name: "Today checklist" });
    const notebook = within(checklist).getByRole("button", { name: /Math notebook/ });
    fireEvent.click(notebook);
    expect(notebook).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Close today checklist" }));
    fireEvent.click(screen.getByRole("button", { name: /Open timetable. Period 1/ }));
    expect(screen.getByRole("dialog", { name: "Class schedule" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close class schedule" }));
    fireEvent.click(screen.getByRole("button", { name: "Timetable" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent("/student/timetable");
  });
});
