import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampusSceneInspector } from "./CampusSceneInspector";
import { CampusSceneEditor } from "./CampusSceneEditor";
import type { CampusSceneDocument, CampusSceneElement } from "./types";

vi.mock("./CampusSceneCanvas", () => ({ CampusSceneCanvas: () => <div aria-label="Campus canvas" /> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fixture: CampusSceneElement = {
  id: "desk", kind: "fixture", label: "Reception desk", asset_key: "desk", width: 2, height: .8,
  geometry: { type: "point", points: [{ x: 12, y: 16 }] },
  space_id: "reception", holding_id: "desk-holding", floor_id: null, review_state: "reviewed",
};
const document: CampusSceneDocument = {
  schema_version: 1, name: "Learning campus", bounds: { width: 100, height: 100, unit: "metres" },
  source: { kind: "manual", label: "Reviewed plan" }, elements: [fixture],
};
const spaces = [{ id: "reception", campus_id: "campus", parent_space_id: null, name: "Reception", code: "R", kind: "office" }];

async function editNumber(name: string, value: string) {
  const input = screen.getByRole("spinbutton", { name });
  await userEvent.clear(input); await userEvent.type(input, value); await userEvent.keyboard("{Enter}");
}

describe("editable indoor fixture presentation", () => {
  it("edits depth and orientation without changing canonical links and lets Escape discard a partial change", async () => {
    const changed = vi.fn();
    function Harness() {
      const [element, setElement] = useState(fixture);
      return <CampusSceneInspector element={element} scene={document} spaces={spaces} disabled={false}
        onChange={next => { changed(next); setElement(next); }} onDelete={vi.fn()} onDuplicate={vi.fn()} onClose={vi.fn()} />;
    }
    render(<Harness />);
    await userEvent.click(screen.getByText("Position and shape", { exact: true }));
    await editNumber("Depth (m)", "1.2");
    await editNumber("Rotation (°)", "-45");
    expect(changed).toHaveBeenLastCalledWith({ ...fixture, depth: 1.2, rotation_deg: -45, review_state: "needs_review" });
    const count = changed.mock.calls.length;
    const rotation = screen.getByRole("spinbutton", { name: "Rotation (°)" });
    await userEvent.clear(rotation); await userEvent.type(rotation, "90"); await userEvent.keyboard("{Escape}");
    expect(rotation).toHaveValue(-45);
    expect(changed).toHaveBeenCalledTimes(count);
  });

  it("preserves fixture depth and rotation through duplicate, native draft save and JSON download while clearing duplicate identity", async () => {
    const save = vi.fn((scene: CampusSceneDocument, revision: number) => Promise.resolve({ document: scene, revision: revision + 1 }));
    const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:campus-draft");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CampusSceneEditor document={document} revision={7} spaces={spaces}
      publishedVersion={1} initialElementId="desk" onSave={save} onPublish={vi.fn()} /></QueryClientProvider>);
    await userEvent.click(screen.getByText("Position and shape", { exact: true }));
    await editNumber("Depth (m)", ".75");
    await editNumber("Rotation (°)", "90");
    await userEvent.click(screen.getByRole("button", { name: "Duplicate", exact: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save draft", exact: true }));
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[1]).toBe(7);
    const saved = save.mock.calls[0]![0];
    expect(saved.elements[0]).toMatchObject({ ...fixture, depth: .75, rotation_deg: 90, review_state: "needs_review" });
    expect(saved.elements[1]).toMatchObject({ asset_key: "desk", width: 2, depth: .75, height: .8, rotation_deg: 90, space_id: null, floor_id: null, holding_id: null });
    await userEvent.click(screen.getByLabelText("Editor options"));
    await userEvent.click(screen.getByRole("button", { name: "Download draft", exact: true }));
    const blob = create.mock.calls[0]?.[0];
    if (!(blob instanceof Blob)) throw new Error("The draft download did not contain a JSON document.");
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Unreadable draft"));
      reader.onerror = () => reject(new Error("Unreadable draft"));
      reader.readAsText(blob);
    });
    expect(JSON.parse(text)).toEqual(saved);
  });
});
