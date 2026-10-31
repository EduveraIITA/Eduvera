import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { EnrollmentForm } from "./EnrollmentForm";
import { NewStaffDialog } from "../staff-operations/StaffOperationsPage";
import { commitEnrollment, reviewEnrollment, type EnrollmentReview } from "./api";
import { createStaffProfile } from "../staff-operations/api";

vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), reviewEnrollment: vi.fn(), commitEnrollment: vi.fn(), searchGuardians: vi.fn() }));
vi.mock("../staff-operations/api", async original => ({ ...await original<typeof import("../staff-operations/api")>(), createStaffProfile: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const person = { id: "existing-person", label: "Aarav Sharma", first_name: "Aarav", last_name: "Sharma", revision: 4 };
const option = { class_section_id: "class", term_id: "term", class_name: "Class 7A", term_name: "Term 1", starts_on: "2026-04-01", ends_on: "2027-03-31", today: "2026-10-20", next_roll: 3 };
const review: EnrollmentReview = { id: "review", expires_at: "2026-10-20T15:00:00Z", class_name: "Class 7A", term_name: "Term 1", guardian: null, warnings: [],
  input: { school_id: "campus", first_name: "Aarav", last_name: "Sharma", admission_number: "A-3", date_of_birth: null, class_section_id: "class", term_id: "term", roll_number: 3, enrolled_on: "2026-10-20", guardian: null, relationship: "guardian", can_authorize_leave: false } };
function mount(element: React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><MemoryRouter>{element}</MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>); }
describe("existing-person domain attachments", () => {
  it("enrolls the same person without requiring a guardian, date of birth, new identity or account", async () => {
    vi.mocked(reviewEnrollment).mockResolvedValue(review);
    vi.mocked(commitEnrollment).mockResolvedValue({ student_id: "student" });
    const done = vi.fn(); mount(<EnrollmentForm schoolId="campus" person={person} options={[option]} onCancel={vi.fn()} onSaved={done} />);
    expect(screen.queryByLabelText("Student first name")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date of birth (optional)")).not.toBeRequired();
    expect(screen.queryByLabelText("Guardian first name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Allow this guardian/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Admission number"), "A-3");
    await userEvent.click(screen.getByRole("button", { name: "Review enrollment" }));
    expect(await screen.findByRole("heading", { name: "Review before saving" })).toBeVisible();
    expect(reviewEnrollment).toHaveBeenCalledWith({ school_id: "campus", person: { id: "existing-person", expected_revision: 4 }, admission_number: "A-3", date_of_birth: null, class_section_id: "class", term_id: "term", roll_number: 3, enrolled_on: "2026-10-20", guardian: null, relationship: "guardian", can_authorize_leave: false });
    expect(commitEnrollment).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("checkbox", { name: "I have verified the student details." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm enrollment" }));
    await waitFor(() => expect(done).toHaveBeenCalledWith("Aarav Sharma"));
    expect(commitEnrollment).toHaveBeenCalledWith("review");
  });
  it("retains the reviewed enrollment receipt when a commit response is interrupted", async () => {
    vi.mocked(reviewEnrollment).mockResolvedValue(review); vi.mocked(commitEnrollment).mockRejectedValue(new Error("Response interrupted"));
    mount(<EnrollmentForm schoolId="campus" person={person} options={[option]} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Admission number"), "A-3"); await userEvent.click(screen.getByRole("button", { name: "Review enrollment" }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "I have verified the student details." }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm enrollment" })); expect(await screen.findByRole("alert")).toHaveTextContent("interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Confirm enrollment" }));
    expect(vi.mocked(commitEnrollment).mock.calls).toEqual([["review"], ["review"]]);
  });
  it("makes optional family linkage explicit and never offers a fresh guardian identity inside existing-person enrollment", async () => {
    mount(<EnrollmentForm schoolId="campus" person={person} options={[option]} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Link a guardian (optional)" }));
    expect(screen.getByRole("option", { name: "Choose an existing campus person" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Add a new guardian" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review enrollment" })).toBeDisabled();
  });
  it("reuses the owning work form with exact person reference and safe retry, without requiring email or inviting", async () => {
    vi.mocked(createStaffProfile).mockRejectedValue(new Error("Work save interrupted"));
    mount(<NewStaffDialog schoolId="campus" person={person} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Add work profile" })).toBeVisible();
    expect(screen.queryByLabelText("First name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contact email (optional)")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Phone (optional)")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Staff code"), "W-12"); await userEvent.type(screen.getByLabelText("Position"), "Campus guard");
    await userEvent.click(screen.getByRole("button", { name: "Save work profile" })); expect(await screen.findByRole("alert")).toHaveTextContent("interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Save work profile" }));
    expect(vi.mocked(createStaffProfile).mock.calls[0]).toEqual(vi.mocked(createStaffProfile).mock.calls[1]);
    const body = vi.mocked(createStaffProfile).mock.calls[0]![1];
    expect(body).toEqual(expect.objectContaining({ person: { id: "existing-person", expected_revision: 4 }, staff_code: "W-12", designation: "Campus guard" }));
    expect(body).not.toHaveProperty("email"); expect(body).not.toHaveProperty("phone");
    expect(body).not.toHaveProperty("first_name"); expect(body).not.toHaveProperty("role"); expect(body).toHaveProperty("idempotency_key");
    const previousKey = body.idempotency_key;
    fireEvent.change(screen.getByLabelText("Position"), { target: { value: "Campus assistant" } });
    await userEvent.click(screen.getByRole("button", { name: "Save work profile" }));
    expect(vi.mocked(createStaffProfile).mock.calls[2]![1].idempotency_key).not.toBe(previousKey);
  });
});
