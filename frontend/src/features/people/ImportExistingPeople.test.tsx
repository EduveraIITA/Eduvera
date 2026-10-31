import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { ImportRowEditor } from "./ImportRowEditor";
import { updateImportRow, type ImportDetail, type ImportRow } from "./import-api";
import { getParticipant, listParticipants } from "./participationApi";

vi.mock("./import-api", async original => ({ ...await original<typeof import("./import-api")>(), updateImportRow: vi.fn() }));
vi.mock("./participationApi", async original => ({ ...await original<typeof import("./participationApi")>(), listParticipants: vi.fn(), getParticipant: vi.fn() }));
const row: ImportRow = { row_number: 2, values: { admission_number: "A-1", first_name: "CSV", last_name: "Name", date_of_birth: "", class: "7A", roll_number: "1", enrolled_on: "2026-10-20", guardian_key: "", guardian_first_name: "", guardian_last_name: "", guardian_phone: "", guardian_email: "", relationship: "guardian" }, decision: "include", guardian_choice: { mode: "new" }, errors: [], warnings: [], guardian_name: "", class_name: "7A" };
const job: ImportDetail = { id: "job", filename: "enroll.csv", state: "draft", revision: 6, row_count: 1, created_at: "2026-10-20T12:00:00Z", expires_at: "2026-10-21T12:00:00Z", receipt: null, review: null };
beforeEach(() => {
  vi.mocked(listParticipants).mockResolvedValue({ page: 1, page_size: 25, total: 2, results: [{ id: "learner-person", label: "Aarav Sharma", affiliations: [], has_account: false }, { id: "guardian-person", label: "Ravi Sharma", affiliations: ["worker"], has_account: true }] });
  vi.mocked(getParticipant).mockImplementation((_school, id) => Promise.resolve({ id, label: id === "learner-person" ? "Aarav Sharma" : "Ravi Sharma", first_name: id === "learner-person" ? "Aarav" : "Ravi", last_name: "Sharma", revision: id === "learner-person" ? 4 : 8, affiliation_sources: [] }));
  vi.mocked(updateImportRow).mockResolvedValue({ revision: 7 });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount() { render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><ImportRowEditor schoolId="campus" job={job} row={row} onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} /></ExecutionEnvironmentProvider></QueryClientProvider>); }
describe("explicit existing-person import review", () => {
  it("captures the selected existing identity and revision, not a name match, and permits no guardian", async () => {
    mount(); await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person to enroll" }), "person");
    expect(screen.getByRole("button", { name: "Save & recheck" })).toBeDisabled();
    expect(screen.queryByLabelText("Student first name")).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("radio", { name: /Aarav Sharma/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save & recheck" })).toBeEnabled());
    expect(screen.getByRole("combobox", { name: "Guardian choice" })).toHaveValue("none");
    await userEvent.click(screen.getByRole("button", { name: "Save & recheck" }));
    const body = vi.mocked(updateImportRow).mock.calls[0]![2];
    expect(body.expected_revision).toBe(6);
    expect(body.guardian_choice).toEqual({ mode: "none" });
    expect(body.values).toMatchObject({ person_id: "learner-person", person_revision: "4", first_name: "Aarav", last_name: "Sharma" });
  });
  it("captures a separately selected existing guardian with its own revision and no access grant", async () => {
    mount(); await userEvent.selectOptions(screen.getByRole("combobox", { name: "Person to enroll" }), "person");
    await userEvent.click(await screen.findByRole("radio", { name: /Aarav Sharma/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save & recheck" })).toBeEnabled());
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Guardian choice" }), "person");
    const guardianSection = screen.getByRole("group", { name: "Guardian person" });
    expect(guardianSection.querySelector('input[type="radio"]')).toBeTruthy();
    await userEvent.click(await within(guardianSection).findByRole("radio", { name: /Ravi Sharma/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save & recheck" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Save & recheck" }));
    const body = vi.mocked(updateImportRow).mock.calls[0]![2];
    expect(body.guardian_choice).toEqual({ mode: "person", person_id: "guardian-person", expected_revision: 8 });
    expect(body.values).toEqual(expect.objectContaining({ guardian_person_id: "guardian-person", guardian_person_revision: "8" }));
    expect(body).not.toHaveProperty("can_authorize_leave");
  });
});
