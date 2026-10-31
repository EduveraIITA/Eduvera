import { useId, useMemo, useState, type ReactNode } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { Box, Building2, ChevronDown, ChevronLeft, ChevronRight, DoorOpen, Layers, Navigation, Search, Wrench, X } from "lucide-react";
import { portalReturnState } from "../navigation/portalReturnState";
import type { CampusMapAsset } from "../campus-view/campusOperational.types";
import type { CampusSceneDocument, CampusSceneElement } from "./types";
import { buildingExplorerAncestors, buildingExplorerMatches, buildingExplorerPlaceKey, buildingExplorerResourceKey, buildingExplorerResourceStatus, sceneBuildingExplorer, type BuildingExplorerNode, type BuildingExplorerPlace } from "./sceneBuildingExplorer";
import "./campus-building-explorer.css";

export interface CampusBuildingExplorerProps {
  building: CampusSceneElement;
  scene: CampusSceneDocument;
  places: readonly BuildingExplorerPlace[];
  assets?: readonly CampusMapAsset[];
  selectedPlaceId?: string | null;
  selectedResourceElementId?: string | null;
  coverage?: "campus" | "mapped";
  placesState?: "loading" | "available" | "unavailable";
  assetsState?: "loading" | "available" | "unavailable";
  onSelectPlace: (spaceId: string) => void;
  onSelectResource: (elementId: string) => void;
  onShowBuilding: () => void;
  onDirections?: (spaceId: string) => void;
  /** The owning workspace supplies this only when reporting is currently permitted. */
  reportHref?: string | null;
  activityContext?: ReactNode;
  selectedDetails?: ReactNode;
}
const PAGE_SIZE = 12;
const NO_ASSETS: readonly CampusMapAsset[] = [];

function ContextualReportLink({ href }: { href: string }) {
  const location = useLocation();
  return <Link className="campus-scene-button" to={href} state={portalReturnState(`${location.pathname}${location.search}`, href)}><Wrench size={16} aria-hidden="true" />Report problem</Link>;
}
function ReportLink({ href }: { href: string }) {
  return useInRouterContext() ? <ContextualReportLink href={href} /> : <a className="campus-scene-button" href={href}><Wrench size={16} aria-hidden="true" />Report problem</a>;
}

export function CampusBuildingExplorer({ building, scene, places, assets = NO_ASSETS, selectedPlaceId, selectedResourceElementId,
  coverage = "mapped", placesState = "available", assetsState = "available", onSelectPlace, onSelectResource,
  onShowBuilding, onDirections, reportHref, activityContext, selectedDetails }: CampusBuildingExplorerProps) {
  const treeId = useId();
  const model = useMemo(() => sceneBuildingExplorer({ building, scene, places, assets }), [building, scene, places, assets]);
  const selectedKey = selectedResourceElementId ? buildingExplorerResourceKey(selectedResourceElementId) : selectedPlaceId ? buildingExplorerPlaceKey(selectedPlaceId) : null;
  const selected = selectedKey ? model.nodes.get(selectedKey) : undefined;
  const ancestors = buildingExplorerAncestors(model, selectedKey);
  const activePath = new Set(ancestors);
  if(selectedKey && selected?.children.length) activePath.add(selectedKey);
  const [expansion, setExpansion] = useState<{ selection: string | null; values: Record<string, boolean> }>({ selection: selectedKey, values: {} });
  const [pages, setPages] = useState<Record<string, number>>({});
  const [finding, setFinding] = useState(false), [search, setSearch] = useState("");
  const matches = buildingExplorerMatches(model, search);
  const firstFloor = model.children.find(node => node.kind === "place" && node.place.kind === "floor")?.id;
  const isOpen = (id: string) => matches ? matches.has(id) : activePath.has(id) && expansion.selection !== selectedKey ? true : expansion.values[id] ?? (activePath.has(id) || !selected && id === firstFloor);
  const toggle = (id: string) => {
    const openPath = Object.fromEntries([...activePath].map(key => [key, true]));
    setExpansion({ selection: selectedKey, values: { ...expansion.values, ...openPath, [id]: !isOpen(id) } });
  };
  const selectedName = selected?.kind === "resource" ? selected.asset.name : selected?.place.name;
  const placeId = selected?.kind === "resource" ? selected.asset.space_id : selected?.place.id ?? building.space_id;
  const selectedAncestors = [...ancestors].reverse().map(id => model.nodes.get(id)).filter(node => node?.kind === "place");
  const breadcrumb = selectedAncestors.map(node => node.place.name).join(" / ");
  const safeReportHref = reportHref && /^\/areas\/facilities(?:[/?#]|$)/.test(reportHref) ? reportHref : null;
  const mappedFloor = (id: string) => scene.elements.some(element => element.review_state === "reviewed" && element.parent_element_id === building.id && (element.floor_id === id || element.navigation_connector?.from_floor_id === id || element.navigation_connector?.to_floor_id === id));
  const placeNote = (node: BuildingExplorerNode) => {
    if (node.kind === "resource") return [node.asset.asset_tag?.trim(), buildingExplorerResourceStatus(node.asset)].filter(Boolean).join(" · ");
    if (node.place.kind === "floor") return mappedFloor(node.place.id) ? "Floor plan" : "Not mapped";
    return node.elementId ? node.place.kind.replaceAll("_", " ") : "Not mapped";
  };
  const choose = (node: BuildingExplorerNode) => node.kind === "resource" ? onSelectResource(node.elementId) : onSelectPlace(node.place.id);
  const branch = (items: BuildingExplorerNode[], parent: string): ReactNode => {
    const available = matches ? items.filter(node => matches.has(node.id)) : items;
    const key = `${parent}:${search.trim().toLocaleLowerCase()}`;
    const selectedIndex = available.findIndex(node => node.id === selectedKey || ancestors.has(node.id));
    const defaultPage = selectedIndex < 0 ? 1 : Math.floor(selectedIndex / PAGE_SIZE) + 1;
    const totalPages = Math.max(1, Math.ceil(available.length / PAGE_SIZE));
    const page = Math.min(pages[key] ?? defaultPage, totalPages);
    return <><ul className="campus-building-explorer__tree" id={`${treeId}-${parent}`}>
      {available.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(node => {
        const childCount = node.children.filter(child => !matches || matches.has(child.id)).length;
        const open = isOpen(node.id), active = node.id === selectedKey;
        const originalName = node.kind === "resource" ? node.asset.name : node.place.name;
        const parentName = node.kind === "resource" ? places.find(place => place.id === node.asset.space_id)?.name : undefined;
        const prefix = parentName ? `${parentName} · ` : "";
        const shortName = node.kind === "resource" && prefix && originalName.startsWith(prefix) && originalName.slice(prefix.length).trim()
          ? originalName.slice(prefix.length) : originalName;
        const name = node.kind === "resource" ? shortName.charAt(0).toLocaleUpperCase() + shortName.slice(1) : originalName;
        const accessibleName = node.kind === "resource" && node.asset.asset_tag?.trim() ? `${name}, ${node.asset.asset_tag.trim()}` : name;
        const Icon = node.kind === "resource" ? Box : node.place.kind === "floor" ? Layers : DoorOpen;
        return <li key={node.id} className="campus-building-explorer__node">
          <div className="campus-building-explorer__row" data-selected={active || undefined}>
            {childCount ? <button type="button" className="campus-building-explorer__disclosure" aria-label={`${open ? "Collapse" : "Expand"} ${name}`} aria-expanded={open} aria-controls={open ? `${treeId}-${node.id}` : undefined} onClick={() => toggle(node.id)}>{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="campus-building-explorer__leaf" aria-hidden="true" />}
            <button type="button" className="campus-building-explorer__select" aria-label={`Show ${accessibleName} on map`} title={node.kind === "resource" ? originalName : undefined} aria-current={active ? "location" : undefined} onClick={() => choose(node)}>
              <Icon size={18} aria-hidden="true" /><span><strong>{name}</strong><small>{placeNote(node)}</small></span>
            </button>
          </div>
          {childCount && open ? branch(node.children, node.id) : null}
        </li>;
      })}
    </ul>{totalPages > 1 ? <nav className="campus-building-explorer__pagination" aria-label={`More ${parent === "root" ? "building places" : model.nodes.get(parent)?.kind === "place" ? (model.nodes.get(parent) as { place: BuildingExplorerPlace }).place.name : "resources"}`}>
      <button type="button" aria-label="Previous places" disabled={page === 1} onClick={() => setPages(value => ({ ...value, [key]: page - 1 }))}><ChevronLeft size={16} /></button>
      <span>{page} of {totalPages}</span>
      <button type="button" aria-label="Next places" disabled={page === totalPages} onClick={() => setPages(value => ({ ...value, [key]: page + 1 }))}><ChevronRight size={16} /></button>
    </nav> : null}</>;
  };
  return <section className="campus-building-explorer" aria-label={`${building.label} explorer`}>
    <div className="campus-building-explorer__overview">
      {selected ? <button type="button" className="campus-building-explorer__building" onClick={onShowBuilding}><Building2 size={17} aria-hidden="true" />Building overview</button> : null}
      <p>{building.levels ? `${building.levels} ${building.levels === 1 ? "floor" : "floors"}` : model.floors ? `${model.floors} known ${model.floors === 1 ? "floor" : "floors"}` : "Floor count not provided"}{model.places ? ` · ${model.places} ${coverage === "mapped" ? "mapped " : ""}${model.places === 1 ? "place" : "places"}` : ""}{model.resources ? ` · ${model.resources} mapped ${model.resources === 1 ? "resource" : "resources"}` : ""}</p>
    </div>
    {selected ? <section className="campus-building-explorer__selected" aria-label="Selected place context"><p>{breadcrumb || (selected.kind === "resource" ? "Resource" : "Inside this building")}</p><h3>{selectedName}</h3>{selected.kind === "place" && selected.place.capacity != null ? <p>Capacity {selected.place.capacity}</p> : null}{placeNote(selected) === "Not mapped" ? <p>This place has no published interior plan yet.</p> : selected.kind === "resource" ? <p>{buildingExplorerResourceStatus(selected.asset)}</p> : null}</section> : null}
    {(onDirections && placeId) || safeReportHref ? <div className="campus-building-explorer__actions">
      {onDirections && placeId ? <button type="button" className="campus-scene-button campus-scene-button--primary" aria-label="Directions to this place" onClick={() => onDirections(placeId)}><Navigation size={16} aria-hidden="true" />Directions</button> : null}
      {safeReportHref ? <ReportLink href={safeReportHref} /> : null}
    </div> : null}
    <section className="campus-building-explorer__contents" aria-label="Building places and resources">
      <header><h3>{coverage === "campus" ? "Inside this building" : "Mapped places"}</h3>{model.nodes.size > 8 ? <button type="button" className="campus-building-explorer__find" aria-expanded={finding} aria-label={finding ? "Close building search" : "Find in building"} onClick={() => { setFinding(value => !value); setSearch(""); }}>{finding ? <X size={17} /> : <Search size={17} />}</button> : null}</header>
      {finding ? <label className="campus-building-explorer__search"><span>Find a place or resource</span><input type="search" value={search} maxLength={120} onChange={event => setSearch(event.target.value)} /></label> : null}
      {placesState === "loading" ? <p className="campus-building-explorer__message" role="status">Loading building places…</p> : placesState === "unavailable" ? <p className="campus-building-explorer__message" role="status">The full building directory is unavailable. Published mapped places remain below.</p> : null}
      {model.children.length && (!matches || matches.size) ? branch(model.children, "root") : <p className="campus-building-explorer__message">{matches ? "No matching place or resource in this building." : "No interior places have been mapped yet."}</p>}
      {assetsState === "loading" ? <p className="campus-building-explorer__message" role="status">Loading mapped resources…</p> : assetsState === "unavailable" ? <p className="campus-building-explorer__message" role="status">Resource details are unavailable.</p> : null}
      <p className="campus-building-explorer__coverage">{coverage === "mapped" ? "Only places linked to the published map are listed. " : ""}Resources are listed when linked to the published map.</p>
    </section>
    {selectedDetails}
    {activityContext ? <details className="campus-building-explorer__activity"><summary>Activity at this place</summary><div>{activityContext}</div></details> : null}
  </section>;
}
