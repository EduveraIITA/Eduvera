import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { resolveSchoolEvent } from "../school/schoolEventProtocol";
import {
  descendants,
  moveNode,
  type OrganizationNode,
  type OrganizationWorkspace,
} from "./api";
import { OrganizationEditor } from "./OrganizationEditor";

const saveOrganization = vi.hoisted(() => vi.fn());
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  saveOrganization,
}));

const data: OrganizationWorkspace = {
  revision: 1,
  can_edit: true,
  staff: [{
    id: "9f38914c-761a-4da9-8235-583250f93e7b",
    first_name: "Anjali",
    last_name: "Mehta",
    designation: "Principal",
    status: "active",
  }],
  nodes: [
    {
      id: "6757a868-7cef-44ae-9279-7f82b6236d57",
      name: "Principal",
      kind: "leadership",
      parent_id: null,
      description: "",
      tone: "violet",
      member_ids: [],
      head_staff_id: "9f38914c-761a-4da9-8235-583250f93e7b",
    },
    {
      id: "5280e2b4-7230-4ef1-9639-8e47255271cf",
      name: "Academics",
      kind: "department",
      parent_id: "6757a868-7cef-44ae-9279-7f82b6236d57",
      description: "Learning",
      tone: "blue",
      member_ids: [],
      head_staff_id: null,
    },
  ],
};

const mount = (workspace = data) => render(<OrganizationEditor
  schoolId="429c926f-7451-4eaa-9084-dfd23353bb37"
  data={workspace}
  onDirty={vi.fn()}
  onReload={vi.fn().mockResolvedValue(undefined)}
/>);

beforeEach(() => {
  saveOrganization.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function showModal(this: HTMLDialogElement) { this.setAttribute("open", ""); },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function close(this: HTMLDialogElement) { this.removeAttribute("open"); },
  });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(cleanup);

describe("organization workspace", () => {
  it("starts progressively, creates a draft and can undo it", () => {
    mount({ ...data, nodes: [] });
    fireEvent.click(screen.getByRole("button", { name: "Add your first node" }));
    expect(screen.getByLabelText("Node name")).toHaveValue("New leadership");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Add your first node" })).toBeInTheDocument();
    expect(saveOrganization).not.toHaveBeenCalled();
  });

  it("filters by people or nodes while retaining the ancestor path", () => {
    mount();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Academics" } });
    expect(screen.getByRole("button", { name: /^Principal Led by/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Academics/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "missing" } });
    expect(screen.getByText("No matching nodes")).toBeInTheDocument();
  });

  it("prevents cyclic parents and saves a renamed node", async () => {
    saveOrganization.mockImplementation((_: string, body: { nodes: OrganizationNode[] }) =>
      Promise.resolve({ nodes: body.nodes, revision: 2, replayed: false }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /^Principal Led by/ }));
    expect(screen.getByLabelText("Reports to").children).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "School leadership" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Organization saved · revision 2/);
    const call = saveOrganization.mock.calls[0] as [string, {
      expected_revision: number;
      request_id: string;
      nodes: OrganizationNode[];
    }];
    expect(call[1].expected_revision).toBe(1);
    expect(call[1].request_id).toBeTypeOf("string");
    expect(call[1].nodes[0]?.name).toBe("School leadership");
  });

  it("reuses the idempotency key after an uncertain response", async () => {
    saveOrganization
      .mockRejectedValueOnce(new Error("Connection lost"))
      .mockImplementationOnce((_: string, body: { nodes: OrganizationNode[] }) =>
        Promise.resolve({ nodes: body.nodes, revision: 2, replayed: true }));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Academics/ }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Learning" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Organization saved/);
    expect(saveOrganization.mock.calls[1]).toEqual(saveOrganization.mock.calls[0]);
  });

  it("preserves a draft on revision conflict", async () => {
    saveOrganization.mockRejectedValue(new ApiError("Changed by another administrator", 409));
    mount();
    fireEvent.click(screen.getByRole("button", { name: /Academics/ }));
    fireEvent.change(screen.getByLabelText("Node name"), { target: { value: "Learning" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Discard draft/ })).toBeInTheDocument();
  });

  it("does not permit a node to move below one of its descendants", () => {
    expect(descendants(data.nodes, data.nodes[0]!.id)).toEqual(new Set([
      data.nodes[0]!.id,
      data.nodes[1]!.id,
    ]));
    expect(moveNode(data.nodes, data.nodes[0]!.id, data.nodes[1]!.id)).toBe(data.nodes);
  });

  it("invalidates the organization query after another administrator saves", () => {
    const resolution = resolveSchoolEvent(JSON.stringify({
      id: "event-1",
      type: "organization.structure.updated",
      created_at: new Date().toISOString(),
      payload: { refresh: ["organization"] },
    }), "organization.structure.updated", "admin");
    expect(resolution.invalidations).toContainEqual({ queryKey: ["organization"] });
  });
});
