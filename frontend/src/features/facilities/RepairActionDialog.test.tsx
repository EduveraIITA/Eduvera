import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { actOnRepair, type RepairAction } from "./facilitiesApi";
import { repairFixture } from "./facilities.test-fixtures";
import { RepairActionDialog } from "./RepairActionDialog";

vi.mock("./facilitiesApi", async original => ({
  ...await original<typeof import("./facilitiesApi")>(), actOnRepair: vi.fn(),
}));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
beforeEach(() => vi.mocked(actOnRepair).mockResolvedValue(repairFixture({ revision: 2 })));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function mount(action: RepairAction, environment: ExecutionEnvironment = { mode: "live" }) {
  const refresh = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
  const repair = repairFixture({ allowed_actions: { accept: true, assign: true, update: true, complete: true, verify: true, reopen: true, add_photo: true } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><MemoryRouter>
    <RepairActionDialog schoolId="school" actorId="actor" repair={repair} action={action} refresh={refresh} onClose={onClose} />
  </MemoryRouter></ExecutionEnvironmentProvider></QueryClientProvider>);
  return { refresh, onClose };
}

describe("task-first repair actions", () => {
  it("accepts responsibility without requiring a note or claiming work started", async () => {
    const user = userEvent.setup(), { refresh } = mount("accept");
    expect(screen.getByRole("textbox")).not.toBeVisible();
    expect(screen.getByText(/Work is not marked as started/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Accept repair" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    const body = vi.mocked(actOnRepair).mock.calls[0]![2];
    expect(body).toEqual({ action: "accept", note: "", expected_revision: 1, command_id: body.command_id });
    expect(body.command_id).toMatch(/^[a-f0-9-]{36}$/);
  });

  it("keeps optional notes available without opening the keyboard on acceptance", async () => {
    const user = userEvent.setup(); mount("accept");
    await user.click(screen.getByText("Add note"));
    const note = screen.getByRole("textbox", { name: "Note Optional" });
    expect(note).not.toHaveAttribute("autofocus");
    await user.type(note, "I will check the projector after class");
    await user.click(screen.getByRole("button", { name: "Accept repair" }));
    await waitFor(() => expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "accept", note: "I will check the projector after class" })));
  });

  it("requires an explicit satisfactory check, not a completion report or optional note", async () => {
    const user = userEvent.setup(), { refresh } = mount("verify");
    const submit = screen.getByRole("button", { name: "Confirm repaired" });
    expect(submit).toBeDisabled(); expect(screen.getByRole("textbox")).not.toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: /I checked the repair/ }));
    await user.click(submit); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "verify", note: "", expected_revision: 1 }));
  });

  it("puts the required progress note first and keeps an estimate optional", async () => {
    const user = userEvent.setup(), { refresh } = mount("update");
    expect(screen.getByRole("textbox", { name: "Update" })).toBeVisible();
    expect(screen.getByLabelText(/Expected finish/)).not.toBeVisible();
    await user.type(screen.getByRole("textbox", { name: "Update" }), "Projector tested; cable replacement underway");
    await user.click(screen.getByRole("button", { name: "Update progress" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "update", status: "in_progress", wait_reason: null, expected_finish_at: null, expected_revision: 1 }));
  });

  it("records a delay and revised estimate as progress, never as completed work", async () => {
    const user = userEvent.setup(), { refresh } = mount("update");
    await user.selectOptions(screen.getByRole("combobox", { name: "Progress" }), "waiting");
    await user.type(screen.getByRole("textbox", { name: "Update" }), "Replacement cable ordered");
    expect(screen.getByRole("button", { name: "Update progress" })).toBeDisabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Waiting for" }), "parts");
    await user.click(screen.getByText("Expected finish", { selector: "summary" }));
    fireEvent.change(screen.getByLabelText(/Expected finish/), { target: { value: "2026-11-02T15:30" } });
    await user.click(screen.getByRole("button", { name: "Update progress" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(actOnRepair).toHaveBeenCalledWith("school", "repair-1", expect.objectContaining({ action: "update", status: "waiting", wait_reason: "parts", note: "Replacement cable ordered", expected_finish_at: new Date("2026-11-02T15:30").toISOString(), expected_revision: 1 }));
    expect(actOnRepair).toHaveBeenCalledOnce();
  });
});
