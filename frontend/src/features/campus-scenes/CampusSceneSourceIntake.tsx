import { useEffect, useRef, useState } from "react";
import { FileImage, MapPin, Pencil, Search, Upload, X } from "lucide-react";
import type { CampusSceneImportCapabilities, CampusSceneImportRequest, CampusSceneLocation } from "./types";
import { isDefinitiveSceneImportFailure } from "./sceneImportFailure";

interface Props {
  hasElements: boolean; disabled: boolean; capabilities?: CampusSceneImportCapabilities;
  onLookup?: (query: string) => Promise<CampusSceneLocation[]>;
  onImport: (request: CampusSceneImportRequest) => Promise<void>;
  onClose: () => void;
}

export function CampusSceneSourceIntake({ hasElements, disabled, capabilities, onLookup, onImport, onClose }: Props) {
  const [method, setMethod] = useState<"name" | "image" | "geojson">("name");
  const [query, setQuery] = useState("");
  const [locations, setLocations] = useState<CampusSceneLocation[]>([]);
  const [location, setLocation] = useState<CampusSceneLocation | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [terminalFailure, setTerminalFailure] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sourceKind, setSourceKind] = useState<"aerial_image" | "site_plan">("aerial_image");
  const [instructions, setInstructions] = useState("");
  const [rights, setRights] = useState(false);
  const [replace, setReplace] = useState(false);
  const [attribution, setAttribution] = useState("");
  const [geojson, setGeojson] = useState("");
  const [fileName, setFileName] = useState("");
  const mapRead = useRef(0);
  const canReplace = !hasElements || replace;
  const lookupAvailable = Boolean(onLookup) && capabilities?.map_search.available !== false;
  const analysisAvailable = capabilities?.image_analysis.available !== false;
  const maxImageBytes = capabilities?.max_image_bytes ?? 4 * 1024 * 1024;
  useEffect(() => {
    return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); };
  }, [imageUrl]);
  const runImport = async (request: CampusSceneImportRequest) => {
    setError(null); setTerminalFailure(false);
    try { await onImport(request); } catch (caught) { setTerminalFailure(isDefinitiveSceneImportFailure(caught)); setError(caught instanceof Error ? caught.message : "We could not prepare this layout. Your current draft is unchanged."); }
  };
  const search = async () => {
    if (!onLookup || query.trim().length < 4 || searching || disabled) return;
    setSearching(true); setError(null); setTerminalFailure(false); setLocation(null); setLocations([]); setSearched(false);
    try { setLocations(await onLookup(query.trim())); setSearched(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Campus search is unavailable. Try a site plan or draw the layout."); }
    finally { setSearching(false); }
  };
  return <section className="campus-scene-source" aria-label="Start from a campus source" aria-busy={disabled || searching}>
    <header className="campus-scene-panel-heading"><div><span className="campus-scene-eyebrow">Make it your campus</span><h2>Start with a real layout</h2></div><button type="button" className="campus-scene-icon-button" aria-label="Close source options" onClick={onClose} disabled={disabled}><X size={20} /></button></header>
    <p>Find your campus, bring a plan, or build with editable buildings and landscape assets.</p>
    <div className="campus-scene-choice-row" aria-label="Layout source">{([
      { key: "name", label: "Campus name", icon: MapPin }, { key: "image", label: "Aerial / plan", icon: FileImage }, { key: "geojson", label: "Map data", icon: Upload },
    ] as const).map(({ key, label, icon: Icon }) => <button key={key} type="button" className="campus-scene-button" aria-pressed={method === key} disabled={disabled || searching} onClick={() => { setMethod(key); setError(null); setTerminalFailure(false); setRights(false); }}><Icon size={18} />{label}</button>)}</div>
    {error ? <p className="campus-scene-error" role="alert">{error}</p> : null}
    {terminalFailure && method === "image" ? <p className="campus-scene-helper">AI attempts may use the allowance even when analysis fails. Start a new attempt only when you are ready to try again, or trace the image yourself.</p> : null}
    {hasElements ? <label className="campus-scene-check"><input type="checkbox" checked={replace} disabled={disabled} onChange={event => setReplace(event.target.checked)} /><span>Replace this draft’s layout with the new source. I can undo this before saving.</span></label> : null}
    <fieldset disabled={disabled} className="campus-scene-fields">
      {method === "name" ? <>
        <form onSubmit={event => { event.preventDefault(); void search(); }}><label>Full campus name<input type="search" value={query} maxLength={120} placeholder="e.g. Indian Institute of Science" onChange={event => setQuery(event.target.value)} /></label><button type="submit" className="campus-scene-button" disabled={!lookupAvailable || query.trim().length < 4 || searching}><Search size={17} />{searching ? "Finding campuses…" : "Find campus"}</button></form>
        {!lookupAvailable ? <p className="campus-scene-notice">{capabilities?.map_search.reason ?? "Campus name search is not connected yet. Upload a plan or draw your campus to continue."}</p> : <p className="campus-scene-helper">Use the full mapped name, then confirm the city in the results. Missing or differently named campuses may need an image or map-data upload.</p>}
        {searched && !locations.length ? <p role="status">No exact campus names found. Check the full name, or use an aerial image or map-data upload.</p> : null}
        {locations.length ? <><div className="campus-scene-location-list" role="radiogroup" aria-label="Campus search results">{locations.map(item => <label key={item.id} className="campus-scene-location"><input type="radio" name="scene-location" checked={location?.id === item.id} onChange={() => setLocation(item)} /><span><strong>{item.name}</strong><small>{item.description}</small></span></label>)}</div><button type="button" className="campus-scene-button campus-scene-button--primary" disabled={!location || !canReplace} onClick={() => { if (location) void runImport({ kind: "location", location, radiusMetres: 300 }); }}>{terminalFailure ? "Start a new attempt" : "Create editable layout"}</button><p className="campus-scene-helper">The draft will include available mapped features. Check the campus boundary and remove nearby features that are outside your campus.</p></> : null}
      </> : null}
      {method === "image" ? <>
        <label>Image type<select value={sourceKind} onChange={event => setSourceKind(event.target.value as "aerial_image" | "site_plan")}><option value="aerial_image">Aerial image</option><option value="site_plan">Campus site plan</option></select></label>
        <label className="campus-scene-upload"><FileImage size={28} /><strong>{file?.name ?? "Choose a campus image"}</strong><span>PNG, JPEG or WebP · up to {Math.floor(maxImageBytes / 1024 / 1024)} MB</span><input aria-label="Campus image" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
          const next = event.target.files?.[0]; setError(null); setTerminalFailure(false);
          if (!next) return;
          setFile(null); setImageUrl(null); setRights(false);
          if (!["image/png", "image/jpeg", "image/webp"].includes(next.type) || next.size > maxImageBytes) { setError(`Choose a PNG, JPEG or WebP smaller than ${Math.floor(maxImageBytes / 1024 / 1024)} MB.`); event.target.value = ""; return; }
          setFile(next); setImageUrl(URL.createObjectURL(next)); setRights(false);
        }} /></label>
        {imageUrl ? <img className="campus-scene-source-preview" src={imageUrl} alt="Selected campus image for creating the draft" /> : null}
        <label className="campus-scene-check"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /><span>I have permission to use and adapt this image to create our campus view.</span></label>
        <p className="campus-scene-helper">Use institution-owned or appropriately licensed imagery. A map screenshot does not by itself grant reconstruction rights.</p>
        <label>Details that help (optional)<textarea rows={3} value={instructions} maxLength={1000} placeholder="Main entrance at the bottom. Library is the L-shaped building. Keep the sports ground open." onChange={event => setInstructions(event.target.value)} /></label>
        {!analysisAvailable ? <p className="campus-scene-notice">{capabilities?.image_analysis.reason ?? "Image analysis is not connected yet."} You can use this image as a guide and trace the layout.</p> : <p className="campus-scene-helper">Image analysis proposes the visible layout. You will review positions, names and floor counts before publishing.</p>}
        <button type="button" className="campus-scene-button campus-scene-button--primary" disabled={!file || !rights || !canReplace} onClick={() => { if (file) void runImport({ kind: "image", file, label: file.name, sourceKind, rightsConfirmed: rights, instructions: instructions.trim() || undefined }); }}>{disabled ? "Preparing layout…" : terminalFailure ? "Start a new attempt" : analysisAvailable ? "Generate campus draft" : "Use image as tracing guide"}</button>
        {error && analysisAvailable && file && rights ? <button type="button" className="campus-scene-button" disabled={!canReplace} onClick={() => void runImport({ kind: "image", file, label: file.name, sourceKind, rightsConfirmed: true, traceOnly: true })}>Trace image instead</button> : null}
      </> : null}
      {method === "geojson" ? <>
        <label>Campus GeoJSON<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={async event => {
          const selected = event.target.files?.[0]; if (!selected) return; setError(null); setTerminalFailure(false);
          const read = ++mapRead.current; setGeojson(""); setFileName(selected.name); setRights(false);
          if (selected.size > 2 * 1024 * 1024) { setError("Choose a GeoJSON file smaller than 2 MB."); return; }
          try { const text = await selected.text(); JSON.parse(text); if (read === mapRead.current) setGeojson(text); } catch { if (read === mapRead.current) setError("This file could not be read as GeoJSON. Export a valid JSON or GeoJSON file and try again."); }
        }} /><small>Building outlines, paths and landscape features in geographic coordinates.</small></label>
        <label>Source and attribution<input value={attribution} maxLength={500} placeholder="e.g. © OpenStreetMap contributors, ODbL" onChange={event => setAttribution(event.target.value)} /></label>
        <label className="campus-scene-check"><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} /><span>I have permission to adapt this map data and have supplied its required attribution.</span></label>
        <button type="button" className="campus-scene-button campus-scene-button--primary" disabled={!geojson || !rights || !attribution.trim() || !canReplace} onClick={() => void runImport({ kind: "geojson", text: geojson, label: fileName, attribution: attribution.trim(), rightsConfirmed: rights })}>{disabled ? "Preparing layout…" : terminalFailure ? "Start a new attempt" : "Import editable map"}</button>
      </> : null}
    </fieldset>
    <div className="campus-scene-source-manual"><span>Have a simple layout in mind?</span><button type="button" className="campus-scene-button" disabled={disabled} onClick={onClose}><Pencil size={17} />Draw manually</button></div>
  </section>;
}
