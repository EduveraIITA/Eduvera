import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pencil, Plus, X } from "lucide-react";
import { CAMPUS_SCENE_ASSETS, type CampusSceneAsset } from "./sceneAssets";
import { isSceneIndoorAssetKey } from "./sceneIndoorAssets";
import { sceneOnboardingReadiness } from "./sceneSetupReadiness";
import type { CampusSceneDocument, CampusSceneSpace } from "./types";

export function CampusSceneAdd({ disabled, indoor = false, onPlace, onDraw, onClose }: { disabled: boolean; indoor?: boolean; onPlace: (asset: CampusSceneAsset) => void; onDraw: (asset: CampusSceneAsset) => void; onClose: () => void }) {
  const [assetIndex, setAssetIndex] = useState(0);
  const assets = indoor ? CAMPUS_SCENE_ASSETS.filter(asset => asset.kind === "room" || asset.kind === "path" || isSceneIndoorAssetKey(asset.key)) : CAMPUS_SCENE_ASSETS;
  const asset = assets[Math.min(assetIndex, assets.length - 1)]!;
  return <section className="campus-scene-add" aria-label="Add campus feature">
    <header className="campus-scene-panel-heading"><h2>Add to your campus</h2><button type="button" className="campus-scene-icon-button" aria-label="Close asset library" onClick={onClose}><X size={20} /></button></header>
    <label>Feature<select value={Math.min(assetIndex, assets.length - 1)} disabled={disabled} onChange={event => setAssetIndex(Number(event.target.value))}>{assets.map((item, index) => <option key={`${item.kind}-${item.key}`} value={index}>{item.label}</option>)}</select></label>
    <p className="campus-scene-helper">Every template can be reshaped, renamed and connected to an existing campus place.</p>
    <div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={disabled} onClick={() => onPlace(asset)}><Plus size={16} />Place template</button><button type="button" className="campus-scene-button" disabled={disabled} onClick={() => onDraw(asset)}><Pencil size={16} />{asset.kind === "tree" || asset.kind === "fixture" ? "Place on plan" : "Draw on plan"}</button></div>
  </section>;
}

export function CampusSceneItems({ scene, selectedId, onSelect, onClose }: { scene: CampusSceneDocument; selectedId: string | null; onSelect: (id: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState<"all" | "needs_review">("all"); const [page, setPage] = useState(1);
  const matches = scene.elements.filter(item => (filter === "all" || item.review_state === "needs_review") && `${item.label} ${item.kind}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const pages = Math.max(1, Math.ceil(matches.length / 8)); const visiblePage = Math.min(page, pages);
  return <section className="campus-scene-items" aria-label="Campus items">
    <header className="campus-scene-panel-heading"><h2>Campus items <small>{scene.elements.length}</small></h2><button type="button" className="campus-scene-icon-button" aria-label="Close campus items" onClick={onClose}><X size={20} /></button></header>
    {scene.elements.length > 8 ? <label>Find an item<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label> : null}
    <div className="campus-scene-choice-row" aria-label="Item review filter"><button type="button" className="campus-scene-button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setPage(1); }}>All</button><button type="button" className="campus-scene-button" aria-pressed={filter === "needs_review"} onClick={() => { setFilter("needs_review"); setPage(1); }}>Needs review</button></div>
    {!matches.length ? <p role="status">{scene.elements.length ? "No matching items." : "Add a building, path or landscape feature to begin."}</p> : <ul className="campus-scene-item-list">{matches.slice((visiblePage - 1) * 8, visiblePage * 8).map(item => <li key={item.id}><button type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)}><span><strong>{item.label || "Unnamed item"}</strong><small>{item.kind}{item.space_id ? " · Linked to a campus place" : " · Visual feature"}</small></span>{item.review_state === "reviewed" ? <Check size={17} aria-label="Reviewed" /> : <span className="campus-scene-review-dot" aria-label="Needs review" />}</button></li>)}</ul>}
    {pages > 1 ? <nav className="campus-scene-pagination" aria-label="Campus items pages"><button type="button" className="campus-scene-icon-button" aria-label="Previous items" disabled={visiblePage === 1} onClick={() => setPage(visiblePage - 1)}><ChevronLeft size={18} /></button><span>{visiblePage} / {pages} · {matches.length} items</span><button type="button" className="campus-scene-icon-button" aria-label="Next items" disabled={visiblePage === pages} onClick={() => setPage(visiblePage + 1)}><ChevronRight size={18} /></button></nav> : null}
  </section>;
}

export function CampusSceneReview({ scene, spaces = [], dirty, issues, busy, onSelect, onPublish, onBack, onReviewAll }: { scene: CampusSceneDocument; spaces?: CampusSceneSpace[]; dirty: boolean; issues: string[]; busy: boolean; onSelect: (id: string) => void; onPublish: () => void; onBack: () => void; onReviewAll: () => void }) {
  const [advisoryPage, setAdvisoryPage] = useState(1);
  const readiness = useMemo(() => sceneOnboardingReadiness(scene, spaces), [scene, spaces]);
  const pages = Math.max(1, Math.ceil(readiness.advisories.length / 6));
  const page = Math.min(advisoryPage, pages);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const signature = JSON.stringify(scene);
  const [confirmation, setConfirmation] = useState<{ signature: string; values: boolean[] }>({ signature, values: [false, false, false] });
  const checks = confirmation.signature === signature ? confirmation.values : [false, false, false];
  const pending = scene.elements.filter(item => item.review_state !== "reviewed");
  return <section className="campus-scene-review" aria-label="Review campus before publishing"><header className="campus-scene-panel-heading"><div><span className="campus-scene-eyebrow">Ready for your campus?</span><h2 ref={heading} tabIndex={-1}>Review and publish</h2></div></header>
    <p>Check the layout, names and linked places. Publishing makes this version available in the campus view.</p>
    <div className="campus-scene-review-counts"><span><strong>{scene.elements.length}</strong> features</span><span><strong>{scene.elements.filter(item => item.space_id).length}</strong> linked places</span><span><strong>{scene.elements.length - pending.length}</strong> reviewed</span></div>
    {scene.source.notes ? <p className="campus-scene-notice">{scene.source.notes}</p> : null}
    {issues.length ? <ul className="campus-scene-issues">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p className="campus-scene-success"><Check size={18} />All features reviewed.</p>}
    {pending.length ? <button type="button" className="campus-scene-button" onClick={() => onSelect(pending[0]!.id)}>Review next item: {pending[0]!.label || "Unnamed item"}</button> : null}
    {pending.length ? <fieldset className="campus-scene-fields campus-scene-review-checklist" disabled={busy}><legend>Or confirm your complete layout</legend>{[
      "Building outlines, entrances and paths match our campus.",
      "I have checked the names, floor counts and landscape features.",
      "Campus place links are correct; decorative features are left unlinked.",
    ].map((label, index) => <label key={label} className="campus-scene-check"><input type="checkbox" checked={checks[index] ?? false} onChange={event => setConfirmation({ signature, values: checks.map((value, position) => position === index ? event.target.checked : value) })} /><span>{label}</span></label>)}<button type="button" className="campus-scene-button" disabled={!checks.every(Boolean) || scene.elements.some(item => !item.label.trim())} onClick={onReviewAll}>Mark layout reviewed</button></fieldset> : null}
    <details className="campus-scene-disclosure"><summary>Directions and optional campus links · {readiness.advisories.length} suggestions</summary><p className="campus-scene-helper">These suggestions do not block publication. Link places and equipment only when your campus needs them.</p>
      {readiness.advisories.length ? <ul className="campus-scene-readiness-list">{readiness.advisories.slice((page - 1) * 6, page * 6).map(issue => <li key={issue.id}><div><strong>{issue.title}</strong><small>{issue.detail}</small></div>{issue.elementId ? <button type="button" className="campus-scene-button" onClick={() => onSelect(issue.elementId!)}>Review</button> : null}</li>)}</ul> : <p>No gaps found in the declared links and journeys.</p>}
      {pages > 1 ? <nav className="campus-scene-pagination" aria-label="Setup suggestions"><button type="button" className="campus-scene-button" disabled={page === 1} onClick={() => setAdvisoryPage(page - 1)}>Previous</button><span>{page} / {pages}</span><button type="button" className="campus-scene-button" disabled={page === pages} onClick={() => setAdvisoryPage(page + 1)}>Next</button></nav> : null}
      <p className="campus-scene-helper">{readiness.counts.routeChecks} entrance journeys checked{readiness.counts.uncheckedRoutes ? `; ${readiness.counts.uncheckedRoutes} not checked` : ""}. {readiness.limitations[0]}</p>
    </details>
    {dirty ? <p className="campus-scene-helper">Save your draft before publishing this version.</p> : null}
    <div className="campus-scene-inline-actions"><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={busy || dirty || Boolean(issues.length)} onClick={onPublish}>{busy ? "Publishing…" : "Publish campus view"}</button><button type="button" className="campus-scene-button" disabled={busy} onClick={onBack}>Keep editing</button></div>
  </section>;
}
