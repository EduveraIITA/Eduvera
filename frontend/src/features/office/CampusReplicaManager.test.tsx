import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampusReplicaManager } from "./CampusReplicaManager";
import { getInstitutionSetup, type InstitutionSetup } from "./api";

vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  getInstitutionSetup: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const setup = (): InstitutionSetup => ({
  school: { id: "school-1", name: "Cambridge International School", code: "CIS", timezone: "Asia/Kolkata", institution_kind: "school" },
  campuses: [{
    id: "campus-1", school_id: "school-1", parent_campus_id: null, name: "Main campus", code: "MAIN", campus_type: "main",
    status: "active", is_primary: true, address_line: "12 School Road", city: "Delhi", state: "Delhi", postal_code: "110001",
    timezone: "Asia/Kolkata", revision: 1,
  }],
  spaces: [{
    id: "space-1", school_id: "school-1", campus_id: "campus-1", parent_space_id: null, name: "Room 204", code: "R204",
    kind: "classroom", capacity: 30, is_accessible: true, is_bookable: true, status: "active", revision: 1,
  }],
  resource_types: [],
  holdings: [],
  classes: [{ id: "class-1", grade: "6", section: "A", academic_year: "2026-27", class_revision: 1, placement_id: "placement-1", campus_id: "campus-1", home_space_id: "space-1", home_space_name: "Room 204", placement_revision: 1, effective_from: "2026-04-01", effective_until: null }],
  staff: [{ id: "staff-1", first_name: "Kavita", last_name: "Mehta", staff_code: "T001", designation: "Teacher", status: "active", assignment_id: "assignment-1", campus_id: "campus-1", assignment_revision: 1, effective_from: "2026-04-01", effective_until: null }],
  activity: [{ id: "activity-1", kind: "setup", action: "space.created", subject_label: "Room 204", item_count: 1, state: "accepted", occurred_at: "2026-10-16T09:00:00.000Z", actor_label: "Ananya Yadav" }],
  signals: [],
  readiness: [
    { key: "campus", label: "Campus", complete: true, detail: "1 active" },
    { key: "spaces", label: "Spaces", complete: true, detail: "1 mapped" },
    { key: "classes", label: "Class campuses", complete: true, detail: "1/1 assigned" },
    { key: "staff", label: "Staff campuses", complete: true, detail: "1/1 assigned" },
  ],
  summary: { campuses: 1, spaces: 1, resources: 0, classes: 1, classes_with_home_space: 1, staff: 1, complete: true },
});

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<MemoryRouter><QueryClientProvider client={client}><CampusReplicaManager schoolId="school-1" /></QueryClientProvider></MemoryRouter>);
}

describe("campus setup", () => {
  it("uses campus language while presenting connected operational records", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup());
    show();

    expect(await screen.findByRole("heading", { name: "Cambridge International School" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Connected records" })).toBeVisible();
    expect(screen.getAllByText("Room 204")).toHaveLength(2);
    expect(screen.getByText("Class 6A")).toBeVisible();
    expect(screen.getByText("Kavita Mehta")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Recent activity" })).toBeVisible();
    expect(screen.getByText("Room 204 added")).toBeVisible();
    expect(screen.queryByText(/digital twin/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/model core/i)).not.toBeInTheDocument();
  });

  it("opens a focused domain editor for a new space", async () => {
    vi.mocked(getInstitutionSetup).mockResolvedValue(setup());
    const user = userEvent.setup();
    show();

    await user.click(await screen.findByRole("button", { name: "Add space" }));
    const dialog = screen.getByRole("dialog", { name: "Add space" });
    expect(within(dialog).getByRole("heading", { name: "Add space" })).toHaveFocus();
    expect(within(dialog).getByLabelText("Campus")).toHaveValue("campus-1");
    expect(within(dialog).getByLabelText("Space name")).toBeVisible();
  });

  it("presents cross-domain evidence as a review signal rather than an automatic conclusion", async () => {
    const data = setup();
    data.signals = [{ id: "signal-1", kind: "attendance_after_exit", severity: "important", owner: "attendance", student_id: "student-1", person_label: "Aarav Sharma", class_label: "Class 6A", activity_label: "Mathematics", gate_label: "Main gate", gate_observed_at: "2026-10-16T08:50:00.000Z", expected_from: "2026-10-16T09:00:00.000Z", expected_until: "2026-10-16T09:45:00.000Z", attendance_status: "present" }];
    vi.mocked(getInstitutionSetup).mockResolvedValue(data);
    show();

    expect(await screen.findByRole("heading", { name: "Signals to review" })).toBeVisible();
    expect(screen.getByText("Aarav Sharma has records to cross-check")).toBeVisible();
    expect(screen.getByText(/does not change attendance or infer absence/i)).toBeVisible();
    expect(screen.getByRole("link", { name: "Attendance" })).toHaveAttribute("href", "/principal/attendance");
  });
});
