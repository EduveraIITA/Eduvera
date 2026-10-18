import { List, Network, Plus, Save, Search, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import {
  personName,
  saveOrganization,
  type OrganizationNode,
  type OrganizationWorkspace,
} from "./api";
import { OrganizationDetails } from "./OrganizationDetails";
import { OrganizationTree } from "./OrganizationTree";

interface OrganizationEditorProps {
  schoolId: string;
  data: OrganizationWorkspace;
  onDirty: (value: boolean) => void;
  onReload: () => Promise<void>;
}

export function OrganizationEditor({
  schoolId,
  data,
  onDirty,
  onReload,
}: OrganizationEditorProps) {
  const [nodes, setNodes] = useState(data.nodes);
  const [saved, setSaved] = useState(data.nodes);
  const [revision, setRevision] = useState(data.revision);
  const [history, setHistory] = useState<OrganizationNode[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<"hierarchy" | "list">("hierarchy");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const request = useRef<{ body: string; id: string } | null>(null);
  const dirty = JSON.stringify(nodes) !== JSON.stringify(saved);
  const editable = data.can_edit && !busy;
  const current = nodes.find((node) => node.id === selected);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return new Set(nodes.map((node) => node.id));
    const result = new Set<string>();
    for (const node of nodes) {
      const people = data.staff
        .filter((person) => node.member_ids.includes(person.id) || node.head_staff_id === person.id)
        .map((person) => `${personName(person)} ${person.designation}`)
        .join(" ");
      if (!`${node.name} ${node.description} ${node.kind} ${people}`.toLowerCase().includes(query)) continue;
      result.add(node.id);
      let parent = node.parent_id;
      while (parent && !result.has(parent)) {
        result.add(parent);
        parent = nodes.find((candidate) => candidate.id === parent)?.parent_id ?? null;
      }
    }
    return result;
  }, [data.staff, nodes, search]);

  const change = (next: OrganizationNode[]) => {
    if (!editable) return;
    setHistory((previous) => [...previous.slice(-49), nodes]);
    setNodes(next);
    setNotice("");
    setError("");
    setConflict(false);
  };

  const add = (parentId: string | null) => {
    if (nodes.length >= 250) {
      setError("This organization supports up to 250 nodes.");
      return;
    }
    const parent = nodes.find((node) => node.id === parentId);
    const kind = !parentId ? "leadership" : parent?.kind === "department" ? "position" : "team";
    const id = crypto.randomUUID();
    change([...nodes, {
      id,
      parent_id: parentId,
      kind,
      name: kind === "leadership" ? "New leadership" : kind === "position" ? "New position" : "New team",
      description: "",
      tone: kind === "leadership" ? "violet" : kind === "team" ? "teal" : "slate",
      head_staff_id: null,
      member_ids: [],
    }]);
    setSearch("");
    setSelected(id);
  };

  const remove = () => {
    if (!current) return;
    const children = nodes.filter((node) => node.parent_id === current.id);
    const detail = children.length
      ? ` Its ${children.length} direct ${children.length === 1 ? "report" : "reports"} will move up one level.`
      : "";
    if (!window.confirm(`Delete “${current.name}” from this draft?${detail} Staff records will not be deleted.`)) return;
    change(nodes
      .filter((node) => node.id !== current.id)
      .map((node) => node.parent_id === current.id ? { ...node, parent_id: current.parent_id } : node));
    setSelected(null);
  };

  const save = async () => {
    if (nodes.some((node) => !node.name.trim())) {
      setError("Give every organization node a name before saving.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    const body = JSON.stringify({ nodes, expected_revision: revision });
    if (request.current?.body !== body) {
      request.current = { body, id: crypto.randomUUID() };
    }
    try {
      const result = await saveOrganization(schoolId, {
        nodes,
        expected_revision: revision,
        request_id: request.current.id,
      });
      setNodes(result.nodes);
      setSaved(result.nodes);
      setRevision(result.revision);
      setHistory([]);
      request.current = null;
      setConflict(false);
      setNotice(`Organization saved · revision ${result.revision}. Permissions and appointments are unchanged.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The organization could not be saved. Your draft is still here.");
      setConflict(cause instanceof ApiError && cause.status === 409);
    } finally {
      setBusy(false);
    }
  };

  const reload = async () => {
    if (dirty && !window.confirm("Discard your draft and load the latest organization?")) return;
    setBusy(true);
    try {
      await onReload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the latest organization.");
      setBusy(false);
    }
  };

  return <>
    <section className="organization-intro">
      <div>
        <span>Institution structure</span>
        <h2>Make reporting lines easy to understand</h2>
        <p>Connect leadership, departments, teams and positions to people already in Staff.</p>
      </div>
      <div className="organization-intro__actions">
        <button type="button" className="organization-secondary-button" disabled={!history.length || busy} onClick={() => {
          const previous = history.at(-1);
          if (!previous) return;
          setNodes(previous);
          setHistory((items) => items.slice(0, -1));
          setNotice("");
        }}><Undo2 size={17} />Undo</button>
        <button type="button" className="organization-primary-button" disabled={!dirty || busy || !data.can_edit || conflict} onClick={() => void save()}><Save size={17} />{busy ? "Saving…" : "Save"}</button>
      </div>
    </section>

    <p className="organization-boundary"><strong>Descriptive only.</strong> Changing this view never changes app permissions, governance authority or formal appointments.</p>
    <div className="organization-status" aria-live="polite">
      {notice || (dirty ? "Unsaved changes" : `All changes saved · revision ${revision}`)}
    </div>
    {data.revision > revision ? <div className="organization-update" role="status">
      <span>A newer saved organization is available. Your draft has not been changed.</span>
      <button type="button" onClick={() => void reload()} disabled={busy}>Load latest</button>
    </div> : null}
    {error ? <div className="organization-error" role="alert">
      <span>{error}</span>
      {conflict ? <button type="button" onClick={() => void reload()} disabled={busy}>Discard draft & load latest</button> : null}
    </div> : null}

    <section className="organization-board" aria-label="Organization workspace">
      <div className="organization-toolbar">
        <div className="organization-view-switch" role="group" aria-label="Organization view">
          <button type="button" aria-pressed={mode === "hierarchy"} onClick={() => setMode("hierarchy")}><Network size={18} />Structure</button>
          <button type="button" aria-pressed={mode === "list"} onClick={() => setMode("list")}><List size={18} />List</button>
        </div>
        <label className="organization-search"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search organization" placeholder="Search people or teams" value={search} onChange={(event) => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Clear search" onClick={() => setSearch("")}><X size={17} /></button> : null}</label>
        <button type="button" className="organization-add-button" disabled={!editable} onClick={() => add(null)}><Plus size={18} />Add</button>
      </div>
      <div className="organization-canvas">
        {!nodes.length ? <div className="organization-empty">
          <span><Network size={32} /></span>
          <h3>Start with one clear reporting line</h3>
          <p>Add leadership first. Departments, teams, positions and staff can be connected progressively.</p>
          <button type="button" className="organization-primary-button" disabled={!editable} onClick={() => add(null)}><Plus size={18} />Add your first node</button>
        </div> : !visible.size ? <div className="organization-empty">
          <span><Search size={29} /></span>
          <h3>No matching nodes</h3>
          <p>Try another person, team or department.</p>
          <button type="button" className="organization-secondary-button" onClick={() => setSearch("")}>Clear search</button>
        </div> : <OrganizationTree
          nodes={nodes}
          staff={data.staff}
          selected={selected}
          visible={visible}
          mode={mode}
          filtering={Boolean(search.trim())}
          onSelect={setSelected}
        />}
      </div>
    </section>

    {current ? <OrganizationDetails
      key={current.id}
      node={current}
      nodes={nodes}
      staff={data.staff}
      editable={editable}
      onChange={(updated) => change(nodes.map((node) => node.id === updated.id ? updated : node))}
      onClose={() => setSelected(null)}
      onDelete={remove}
      onSelect={setSelected}
      onAdd={() => add(current.id)}
    /> : null}
  </>;
}
