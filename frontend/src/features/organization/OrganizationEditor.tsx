import { List, Maximize2, Minus, Network, Plus, Save, Search, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { descendants, moveNode, personName, saveOrganization, type OrganizationNode, type OrganizationWorkspace } from "./api";
import { OrganizationDetails } from "./OrganizationDetails";
import { OrganizationTree } from "./OrganizationTree";

interface Props { schoolId: string; data: OrganizationWorkspace; onDirty: (value: boolean) => void; onReload: () => Promise<void> }
export function OrganizationEditor({ schoolId, data, onDirty, onReload }: Props) {
  const [nodes, setNodes] = useState(data.nodes), [saved, setSaved] = useState(data.nodes), [revision, setRevision] = useState(data.revision);
  const [history, setHistory] = useState<OrganizationNode[][]>([]), [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"hierarchy" | "list">("hierarchy"), [zoom, setZoom] = useState(100);
  const [search, setSearch] = useState(""), [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false);
  const request = useRef<{ body: string; id: string } | null>(null), canvas = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(nodes) !== JSON.stringify(saved), editable = data.can_edit && !busy;
  const current = nodes.find(node => node.id === selected);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      if (link && link.href !== window.location.href && !window.confirm("Discard unsaved organization changes?")) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener("beforeunload", unload); document.addEventListener("click", navigate, true);
    return () => { window.removeEventListener("beforeunload", unload); document.removeEventListener("click", navigate, true); };
  }, [dirty]);
  const visible = useMemo(() => {
    const scoped = department && nodes.some(node => node.id === department) ? descendants(nodes, department) : new Set(nodes.map(node => node.id));
    const result = new Set<string>();
    const query = search.trim().toLowerCase();
    for (const node of nodes) {
      const people = data.staff.filter(person => node.member_ids.includes(person.id) || node.head_staff_id === person.id).map(person => `${personName(person)} ${person.designation}`).join(" ");
      if (!scoped.has(node.id) || !`${node.name} ${node.description} ${node.kind} ${people}`.toLowerCase().includes(query)) continue;
      result.add(node.id);
      let parent = node.parent_id;
      while (parent && !result.has(parent)) { result.add(parent); parent = nodes.find(item => item.id === parent)?.parent_id ?? null; }
    }
    return result;
  }, [nodes, search, department, data.staff]);
  function change(next: OrganizationNode[]) {
    if (!editable) return;
    setHistory(previous => [...previous.slice(-49), nodes]); setNodes(next); setNotice("");
  }
  function add(parent: string | null) {
    if (nodes.length >= 250) { setError("This structure supports up to 250 nodes."); return; }
    const id = crypto.randomUUID(), kind = parent ? nodes.find(node => node.id === parent)?.kind === "department" ? "position" : "department" : "leadership";
    change([...nodes, { id, parent_id: parent, kind, name: kind === "leadership" ? "New leadership" : kind === "department" ? "New department" : "New position", description: "", tone: kind === "leadership" ? "violet" : "blue", head_staff_id: null, member_ids: [] }]);
    setSearch(""); setDepartment(""); setSelected(id);
  }
  function move(id: string, parent: string | null) {
    if (parent && descendants(nodes, id).has(parent)) { setError("A node cannot report to itself or one of its descendants."); return; }
    change(moveNode(nodes, id, parent)); setNotice("Reporting line changed in your draft. Save changes to apply it.");
  }
  function remove() {
    if (!current) return;
    const children = nodes.filter(node => node.parent_id === current.id);
    if (!window.confirm(`Delete “${current.name}” from this draft?${children.length ? ` Its ${children.length} direct reports will move to its parent.` : ""} Staff records will not be deleted.`)) return;
    change(nodes.filter(node => node.id !== current.id).map(node => node.parent_id === current.id ? { ...node, parent_id: current.parent_id } : node)); setSelected(null);
  }
  async function save() {
    if (nodes.some(node => !node.name.trim())) { setError("Give every node a name before saving."); return; }
    setBusy(true); setError(""); setNotice("");
    const body = JSON.stringify({ nodes, expected_revision: revision });
    if (request.current?.body !== body) request.current = { body, id: crypto.randomUUID() };
    try {
      const result = await saveOrganization(schoolId, { nodes, expected_revision: revision, request_id: request.current.id });
      setNodes(result.nodes); setSaved(result.nodes); setRevision(result.revision); setHistory([]); request.current = null; setConflict(false);
      setNotice(`Organization saved · revision ${result.revision}. Permissions and appointments are unchanged.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The organization could not be saved. Retry with your draft intact."); setConflict(cause instanceof ApiError && cause.status === 409); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (dirty && !window.confirm("Discard your draft and load the latest saved organization?")) return;
    setBusy(true);
    try { await onReload(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reload."); setBusy(false); }
  }
  function fit() {
    const content = canvas.current?.querySelector<HTMLElement>(".org-tree");
    if (!content || !canvas.current) return;
    setZoom(Math.max(40, Math.min(100, Math.floor((canvas.current.clientWidth - 48) / content.scrollWidth * 100))));
    canvas.current.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }
  return <>
    <header className="org-heading"><div><h1>Organization Hierarchy</h1><p>View and manage your institution’s structure.</p></div><div className="org-actions"><button type="button" className="org-secondary" disabled={!history.length || busy} onClick={() => { const previous = history.at(-1); if (previous) { setNodes(previous); setHistory(history.slice(0, -1)); setNotice(""); } }}><Undo2 size={17}/>Undo</button><button type="button" className="org-primary" disabled={!dirty || busy || !data.can_edit || conflict} onClick={() => void save()}><Save size={17}/>{busy ? "Saving…" : "Save changes"}</button></div></header>
    <div className="org-status" aria-live="polite">{notice || (dirty ? "Unsaved changes" : `All changes saved · revision ${revision}`)}</div>
    {data.revision > revision && <div className="org-update" role="status"><span>A newer saved structure is available.{dirty ? " Your draft has not been changed." : ""}</span><button type="button" className="org-secondary" disabled={busy} onClick={() => void reload()}>Load latest</button></div>}
    {error && <div className="org-error" role="alert"><span>{error}</span>{conflict && <button type="button" onClick={() => void reload()} disabled={busy}>Discard draft & reload latest</button>}</div>}
    <section className="org-board" aria-label="Organization workspace">
      <div className="org-toolbar"><div className="org-view-toggle" role="group" aria-label="Organization view"><button type="button" aria-pressed={view === "hierarchy"} onClick={() => setView("hierarchy")}><Network size={18}/>Hierarchy<span className="org-desktop-word"> view</span></button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={18}/>List<span className="org-desktop-word"> view</span></button></div>
        <label className="org-search"><Search size={17}/><input type="search" aria-label="Search people, departments or roles" placeholder="Search people, departments or roles…" value={search} onChange={event => setSearch(event.target.value)}/></label>
        <label className="org-filter"><span className="sr-only">Department</span><select value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{nodes.filter(node => node.kind === "department").map(node => <option key={node.id} value={node.id}>{node.name}</option>)}</select></label>
        <button type="button" className="org-secondary org-add" disabled={!editable} onClick={() => add(null)}><Plus size={17}/>Add node</button>
      </div>
      <div className={`org-main ${current ? "org-main--details" : ""}`}>
        <div className="org-stage"><div className="org-canvas-tools"><p>{view === "hierarchy" ? "Drag a card to change its reporting line, or edit “Reports to”." : "Select a node to edit its details or reporting line."}</p><div className="org-zoom" aria-label="Chart zoom"><button type="button" aria-label="Zoom out" disabled={zoom <= 40} onClick={() => setZoom(value => Math.max(40, value - 10))}><Minus size={16}/></button><output>{zoom}%</output><button type="button" aria-label="Zoom in" disabled={zoom >= 150} onClick={() => setZoom(value => Math.min(150, value + 10))}><Plus size={16}/></button><button type="button" aria-label="Fit chart to view" onClick={fit}><Maximize2 size={16}/></button></div></div>
          <div ref={canvas} className={`org-canvas ${view === "list" ? "org-canvas--list" : ""}`} tabIndex={0} aria-label="Reporting chart; scroll to explore">
            {!nodes.length ? <div className="org-empty"><span><Network size={36}/></span><h2>Give your institution a clear structure</h2><p>Start with a leadership node, then add departments, teams and positions. Connect people from your staff directory.</p><button type="button" className="org-primary" disabled={!editable} onClick={() => add(null)}><Plus size={18}/>Add your first node</button></div> : !visible.size ? <div className="org-empty"><Search size={30}/><h2>No matching nodes</h2><p>Try another name, role or department.</p><button type="button" className="org-secondary" onClick={() => { setSearch(""); setDepartment(""); }}>Clear filters</button></div> : <div className="org-scaled" style={{ zoom: view === "hierarchy" ? zoom / 100 : 1 }}><OrganizationTree nodes={nodes} staff={data.staff} selected={selected} visible={visible} list={view === "list"} filtering={Boolean(search.trim() || department)} editable={editable} onSelect={setSelected} onMove={move} onAdd={add}/></div>}
          </div>
          <footer className="org-legend" aria-label="Node types"><span><i className="org-tone-violet"/>Leadership</span><span><i className="org-tone-blue"/>Department</span><span><i className="org-tone-teal"/>Team</span><span><i className="org-tone-slate"/>Position</span></footer>
        </div>
        {current && <OrganizationDetails key={current.id} node={current} nodes={nodes} staff={data.staff} editable={editable} onChange={node => change(nodes.map(item => item.id === node.id ? node : item))} onClose={() => setSelected(null)} onDelete={remove} onSelect={setSelected} onAdd={() => add(current.id)}/>}
      </div>
    </section>
  </>;
}
