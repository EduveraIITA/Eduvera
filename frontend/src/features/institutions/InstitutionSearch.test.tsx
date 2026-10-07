import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { InstitutionSearch } from "./InstitutionSearch";
import { CreateInstitution } from "./CreateInstitution";
import type { Institution } from "./api";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("../../lib/api", async (original) => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: apiMock }));
const available: Institution = { id: "directory-1", name: "Delhi Public School", institution_type: "school", source: "UDISE", source_code: "00123456789", state: "Chhattisgarh", city: "Raipur", district: "Raipur", address: "School Road", is_verified: true, is_onboarded: false, eduera_institution_id: null, onboarding_status: "not_onboarded", action: "create" };
beforeEach(() => { apiMock.mockReset(); apiMock.mockResolvedValue({ results: [available] }); });
afterEach(cleanup);

describe("Institution autocomplete", () => {
  it("debounces searches, enforces two characters and supports keyboard selection", async () => {
    const selected = vi.fn(); const user = userEvent.setup();
    render(<InstitutionSearch onSelect={selected} onManual={vi.fn()} />);
    await user.type(screen.getByRole("combobox"), "D");
    expect(apiMock).not.toHaveBeenCalled();
    await user.type(screen.getByRole("combobox"), "elhi");
    expect(screen.getByText("Searching institutions…")).toBeVisible();
    expect(await screen.findByRole("option")).toHaveTextContent("Create Eduera account");
    expect(apiMock).toHaveBeenCalledTimes(1);
    await user.keyboard("{ArrowDown}{Enter}");
    expect(selected).toHaveBeenCalledWith(available);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it.each([
    ["active", "View institution", "✓ Already on Eduera"],
    ["setup_in_progress", "Continue setup", "Setup in progress"],
    ["suspended", "View institution", "Already on Eduera · Suspended"],
  ] as const)("shows %s without a create action", async (status, action, badge) => {
    apiMock.mockResolvedValue({ results: [{ ...available, is_onboarded: true, eduera_institution_id: "school-1", onboarding_status: status }] });
    render(<InstitutionSearch onSelect={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Delhi" } });
    expect(await screen.findByRole("option")).toHaveTextContent(action);
    expect(screen.getByText(badge)).toBeVisible();
    expect(screen.queryByText("Create Eduera account")).not.toBeInTheDocument();
  });

  it("shows no-results and manual fallback, closes on outside pointer and Escape", async () => {
    apiMock.mockResolvedValue({ results: [] }); const manual = vi.fn(); const user = userEvent.setup();
    render(<InstitutionSearch onSelect={vi.fn()} onManual={manual} />);
    await user.type(screen.getByRole("combobox"), "Unknown");
    expect(await screen.findByText("No institutions found.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "+ Add institution manually" }));
    expect(manual).toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
    await user.click(screen.getByRole("combobox")); await user.keyboard("{Escape}");
    expect(screen.getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
  });

  it("ignores stale responses after query changes", async () => {
    let resolveOld!: (value: { results: Institution[] }) => void;
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; })).mockResolvedValue({ results: [] });
    render(<InstitutionSearch onSelect={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Delhi" } });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Unknown" } });
    await screen.findByText("No institutions found.");
    resolveOld({ results: [available] });
    await waitFor(() => expect(screen.queryByRole("option")).not.toBeInTheDocument());
  });

  it("renders search errors and preserves manual fallback", async () => {
    apiMock.mockRejectedValue(new Error("Search unavailable"));
    render(<InstitutionSearch onSelect={vi.fn()} onManual={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Delhi" } });
    expect(await screen.findByText("Search unavailable")).toBeVisible();
    expect(screen.getByRole("button", { name: "+ Add institution manually" })).toBeVisible();
  });
});

function renderCreate() {
  render(<MemoryRouter initialEntries={["/company"]}><Routes><Route path="/company" element={<CreateInstitution />} /><Route path="/company/institutions/:id" element={<h1>Institution setup</h1>} /></Routes></MemoryRouter>);
}

describe("Create Institution flow", () => {
  it("confirms a selection and sends the stable directory ID", async () => {
    const user = userEvent.setup(); renderCreate();
    await user.type(screen.getByRole("combobox"), "Delhi");
    await user.click(await screen.findByRole("option"));
    expect(screen.getByRole("heading", { name: "Confirm institution details" })).toBeVisible();
    apiMock.mockResolvedValue({ school: { id: "school-1" }, invitation: { token: "invite" } });
    await user.type(screen.getByLabelText("First administrator email"), "admin@example.test");
    await user.click(screen.getByRole("button", { name: "Create & invite admin" }));
    expect(apiMock).toHaveBeenLastCalledWith("/api/v1/company/institutions/", expect.objectContaining({ method: "POST" }));
    const payload = JSON.parse((apiMock.mock.calls.at(-1)![1] as RequestInit).body as string) as { directory_id: string };
    expect(payload.directory_id).toBe(available.id);
    expect(await screen.findByRole("heading", { name: "Institution setup" })).toBeVisible();
  });

  it("opens an existing institution without posting a new tenant", async () => {
    apiMock.mockResolvedValue({ results: [{ ...available, is_onboarded: true, eduera_institution_id: "school-1", onboarding_status: "setup_in_progress" }] });
    const user = userEvent.setup(); renderCreate();
    await user.type(screen.getByRole("combobox"), "Delhi"); await user.click(await screen.findByRole("option"));
    expect(await screen.findByRole("heading", { name: "Institution setup" })).toBeVisible();
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it("warns about manual duplicates before enabling explicit creation", async () => {
    const duplicate = { ...available, eduera_institution_id: "school-1", is_onboarded: true, onboarding_status: "active" };
    apiMock.mockRejectedValue(new ApiError("Possible existing institutions found.", 409, { error: { fields: { duplicates: [duplicate] } } }));
    const user = userEvent.setup(); renderCreate();
    await user.click(screen.getByRole("button", { name: /Add institution manually/ }));
    for (const [label, value] of [["Institution name", "Delhi Public School"], ["State", "Chhattisgarh"], ["City", "Raipur"], ["Address", "New campus"], ["First administrator email", "admin@example.test"]]) {
      await user.type(screen.getByLabelText(label!), value!);
    }
    await user.click(screen.getByRole("button", { name: "Create & invite admin" }));
    expect(await screen.findByRole("heading", { name: "Possible existing institutions" })).toBeVisible();
    expect(screen.getByRole("link", { name: "View institution" })).toHaveAttribute("href", "/company/institutions/school-1");
    expect(screen.getByRole("button", { name: "Create & invite admin" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create & invite admin" })).toBeEnabled();
    apiMock.mockResolvedValue({ school: { id: "school-2" }, invitation: { token: "invite" } });
    await user.click(screen.getByRole("button", { name: "Create & invite admin" }));
    const payload = JSON.parse((apiMock.mock.calls.at(-1)![1] as RequestInit).body as string) as { acknowledged_duplicate_ids: string[] };
    expect(payload.acknowledged_duplicate_ids).toEqual(["school-1"]);
  });
});
