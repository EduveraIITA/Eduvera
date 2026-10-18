import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { descendants, moveNode, type OrganizationWorkspace, type OrganizationNode } from "./api";
import { OrganizationEditor } from "./OrganizationEditor";
import { resolveSchoolEvent } from "../school/schoolEventProtocol";

const save = vi.hoisted(() => vi.fn());
vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(), saveOrganization: save }));
const data: OrganizationWorkspace = { revision: 1, can_edit: true, staff: [{ id: "staff", first_name: "Anjali", last_name: "Mehta", designation: "Principal", status: "active" }], nodes: [
  { id: "root", name: "Principal", kind: "leadership", parent_id: null, description: "", tone: "violet", member_ids: [], head_staff_id: "staff" },
  { id: "academic", name: "Academics", kind: "department", parent_id: "root", description: "Learning", tone: "blue", member_ids: [], head_staff_id: null },
] };
const mount = (workspace = data) => render(<OrganizationEditor schoolId="school" data={workspace} onDirty={vi.fn()} onReload={vi.fn().mockResolvedValue(undefined)}/>);
beforeEach(() => {
  save.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "show", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute("open", ""); } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(cleanup);
describe("organization workspace", () => {
  it("shows a real empty state, creates a draft, and undoes it", () => {
    mount({ ...data, nodes: [] }); fireEvent.click(screen.getByRole("button", { name: "Add your first node" }));
    expect(screen.getByLabelText("Node name")).toHaveValue("New leadership");
    fireEvent.click(screen.getByRole("button", { name: "Done" })); fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Add your first node" })).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
  });
  it("filters by people and keeps ancestor paths", () => {
    mount(); fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Academics" } });
    expect(screen.getByRole("button", { name: /Principal Anjali/ })).toBeInTheDocument(); expect(screen.getByRole("button", { name: /Academics 0 members/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } }); expect(screen.getByText("No matching nodes")).toBeInTheDocument();
  });
  it("prevents cyclic parent selection and persists a renamed node", async () => {
    save.mockImplementation((_school: string, body: { nodes: OrganizationNode[] }) => Promise.resolve({ nodes: body.nodes, revision: 2 })); mount();
    fireEvent.click(screen.getByRole("button", { name: /Principal Anjali/ }));
    expect(screen.getByLabelText("Reports to").children).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "School leadership" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Organization saved · revision 2/);
    const call = save.mock.calls[0] as [string, { expected_revision: number; request_id: string; nodes: OrganizationNode[] }];
    expect(call[0]).toBe("school"); expect(call[1].expected_revision).toBe(1); expect(call[1].request_id).toBeTypeOf("string"); expect(call[1].nodes[0]?.name).toBe("School leadership");
  });
  it("keeps the same idempotency key after an uncertain response", async () => {
    save.mockRejectedValueOnce(new Error("Connection lost")).mockImplementationOnce((_school: string, body: { nodes: OrganizationNode[] }) => Promise.resolve({ nodes: body.nodes, revision: 2 })); mount();
    fireEvent.click(screen.getByRole("button", { name: /Academics 0 members/ })); fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Learning" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByText(/Organization saved/); expect(save.mock.calls[1]).toEqual(save.mock.calls[0]);
  });
  it("preserves drafts on conflict and does not silently overwrite newer data", async () => {
    save.mockRejectedValue(new ApiError("Changed by another administrator", 409)); mount();
    fireEvent.click(screen.getByRole("button", { name: /Academics 0 members/ })); fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Learning" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" })); await screen.findByRole("alert");
    expect(screen.getByLabelText("Node name")).toHaveValue("Learning"); expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Discard draft/ })).toBeInTheDocument();
  });
  it("adds existing staff, and deletion promotes reports without deleting people", () => {
    mount(); fireEvent.click(screen.getByRole("button", { name: /Academics 0 members/ })); fireEvent.click(screen.getByRole("tab", { name: "Members (0)" }));
    fireEvent.click(screen.getByRole("button", { name: /Anjali Mehta Principal/ })); expect(screen.getByRole("tab", { name: "Members (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" })); fireEvent.click(screen.getByRole("button", { name: /Principal Anjali/ })); fireEvent.click(screen.getByRole("button", { name: "Delete node" }));
    expect(screen.getByRole("button", { name: /Academics 1 members/ })).toBeInTheDocument(); expect(save).not.toHaveBeenCalled();
  });
  it("rejects cycle-producing moves", () => { expect(descendants(data.nodes, "root")).toEqual(new Set(["root", "academic"])); expect(moveNode(data.nodes, "root", "academic")).toBe(data.nodes); });
  it("invalidates organization data when a saved reporting structure changes", () => {
    const event = resolveSchoolEvent(JSON.stringify({ id: "event-1", type: "organization.structure.updated", created_at: new Date().toISOString(), payload: { refresh: ["organization"] } }), "organization.structure.updated", "admin");
    expect(event.invalidations).toContainEqual({ queryKey: ["organization"] });
  });
  it("announces a newer revision without overwriting an edited draft", () => {
    const props = { schoolId: "school", onDirty: vi.fn(), onReload: vi.fn().mockResolvedValue(undefined) };
    const result = render(<OrganizationEditor {...props} data={data}/>);
    fireEvent.click(screen.getByRole("button", { name: /Academics 0 members/ })); fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "My draft" } });
    result.rerender(<OrganizationEditor {...props} data={{ ...data, revision: 2 }}/>);
    expect(screen.getByText(/A newer saved structure is available/)).toBeInTheDocument(); expect(screen.getByLabelText("Node name")).toHaveValue("My draft");
  });
});
