import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { resolveSchoolEvent } from "../school/schoolEventProtocol";
import {
  descendants,
  moveNode,
  rearrangeNode,
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
    expect(screen.getByRole("button", { name: /^Academics/ })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /^Academics/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /^Academics/ }));
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


describe('role default charts and rearranging',()=>{
  it('lets the first role chart be saved immediately',async()=>{
    saveOrganization.mockResolvedValue({revision:1,nodes:data.nodes});
    mount({...data,revision:0,generated:true});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(saveOrganization).toHaveBeenCalledWith(expect.any(String),expect.objectContaining({expected_revision:0,nodes:data.nodes})));
  });
  it('reparents, reorders and rejects cycles',()=>{
    const third={...data.nodes[1]!,id:'b572d92c-3646-4a6f-ac22-6383824d5392',name:'Office'};
    const nodes=[...data.nodes,third];
    expect(rearrangeNode(nodes,third.id,data.nodes[1]!.id,'before').map(node=>node.name)).toEqual(['Principal','Office','Academics']);
    const nested=rearrangeNode(nodes,third.id,data.nodes[1]!.id,'inside');
    expect(nested.find(node=>node.id===third.id)?.parent_id).toBe(data.nodes[1]!.id);
    expect(rearrangeNode(nested,data.nodes[0]!.id,third.id,'inside')).toBe(nested);
    expect(rearrangeNode(nodes,third.id,null,'root').find(node=>node.id===third.id)?.parent_id).toBeNull();
  });
  it('supports keyboard rearranging, undo and saving the changed reporting line',async()=>{
    mount();
    fireEvent.keyDown(screen.getByRole('button',{name:'Move Academics'}),{key:'ArrowLeft'});
    expect(screen.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
    fireEvent.click(screen.getByRole('button',{name:'Undo'}));
    expect(screen.getByRole('button',{name:'Save',exact:true})).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button',{name:'Move Academics'}),{key:'ArrowLeft'});
    saveOrganization.mockResolvedValue({revision:2,nodes:rearrangeNode(data.nodes,data.nodes[1]!.id,null,'root')});
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}));
    await waitFor(()=>expect(saveOrganization).toHaveBeenCalled());
    const payload=saveOrganization.mock.calls[0]![1] as {nodes:OrganizationNode[]};
    expect(payload.nodes.find(node=>node.name==='Academics')?.parent_id).toBeNull();
  });
  it('moves a node through a touch or mouse pointer drag to the top level',()=>{
    mount();
    const handle=screen.getByRole('button',{name:'Move Academics'});
    Object.defineProperty(handle,'setPointerCapture',{value:vi.fn(),configurable:true});
    const drop=screen.getByText('Drop here for top level');
    Object.defineProperty(document,'elementFromPoint',{value:()=>drop,configurable:true});
    for(const [type,x] of [['pointerdown',100],['pointermove',130],['pointerup',130]] as const){
      fireEvent(handle,Object.assign(new Event(type,{bubbles:true}),{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:150}));
    }
    expect(screen.getByRole('button',{name:'Save',exact:true})).toBeEnabled();
    expect(screen.getByText('Reporting line updated. Save to keep your changes.')).toBeVisible();
  });
  it('disables moving when the workspace is read only',()=>{
    mount({...data,can_edit:false});
    expect(screen.getByRole('button',{name:'Move Academics'})).toBeDisabled();
  });
});
