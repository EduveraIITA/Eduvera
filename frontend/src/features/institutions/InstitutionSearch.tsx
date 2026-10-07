import { useEffect, useId, useRef, useState } from "react";
import { InstitutionBadges, institutionAction, searchInstitutions, type Institution } from "./api";

export function InstitutionSearch({ onSelect, onManual }: { onSelect: (item: Institution) => void; onManual: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Institution[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [completedQuery, setCompletedQuery] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const id = useId();

  useEffect(() => {
    if (active >= 0) document.getElementById(`${id}-option-${active}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active, id]);

  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const current = generation.current;
    const timer = setTimeout(() => {
      void searchInstitutions(query.trim(), controller.signal).then(({ results }) => {
        if (current !== generation.current || controller.signal.aborted) return;
        setResults(results); setCompletedQuery(query); setLoading(false);
      }).catch((err: unknown) => {
        if (current !== generation.current || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Search failed. Try again."); setLoading(false);
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  const select = (item: Institution) => { setOpen(false); onSelect(item); };
  const visible = open && query.trim().length >= 2;
  return <div className="institution-search" ref={root} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>Search institution</label>
    <input id={id} role="combobox" autoComplete="off" aria-autocomplete="list" aria-expanded={visible} aria-controls={`${id}-results`}
      aria-activedescendant={visible && active >= 0 ? `${id}-option-${active}` : undefined}
      aria-describedby={`${id}-hint`} placeholder="Name, UDISE/AISHE code, city or district" value={query}
      onFocus={() => setOpen(true)} onChange={(event) => {
        generation.current++; setQuery(event.target.value); setResults([]); setActive(-1); setError(""); setOpen(true);
        setLoading(event.target.value.trim().length >= 2);
      }} onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setActive(-1); }
        if (["ArrowDown", "ArrowUp"].includes(event.key)) {
          event.preventDefault(); setOpen(true);
          if (results.length) setActive((index) => event.key === "ArrowDown" ? (index + 1) % results.length : (index <= 0 ? results.length - 1 : index - 1));
        }
        if (event.key === "Enter" && visible) {
          event.preventDefault(); if (active >= 0 && results[active]) select(results[active]);
        }
      }} />
    <small id={`${id}-hint`}>Enter at least 2 characters to search.</small>
    {visible && <div className="institution-dropdown">
      <div role="status" aria-live="polite">{loading ? "Searching institutions…" : error || (completedQuery === query && !results.length ? "No institutions found." : `${results.length} institutions found`)}</div>
      <ul id={`${id}-results`} role="listbox" aria-label="Institutions" aria-busy={loading}>
        {results.map((item, index) => <li key={item.id} id={`${id}-option-${index}`} role="option" aria-selected={active === index}
          className={active === index ? "is-highlighted" : ""} onPointerDown={(event) => event.preventDefault()} onClick={() => select(item)}>
          <strong>{item.name}</strong><span>{item.institution_type} · {[item.city || item.district, item.state].filter(Boolean).join(", ")}</span>
          {item.source_code && <small>{item.source}: {item.source_code}</small>}
          <InstitutionBadges item={item} /><span className="institution-result-action">{institutionAction(item)}</span>
        </li>)}
      </ul>
      <div className="institution-manual-option"><span>Can’t find your institution?</span><button type="button" onClick={onManual}>+ Add institution manually</button></div>
    </div>}
    {!visible && <button type="button" className="institution-text-button" onClick={onManual}>Can’t find your institution? + Add institution manually</button>}
    <small>Public directory snapshots may be outdated. Sources: <a href="https://ckandev.indiadataportal.com/dataset/udise" target="_blank" rel="noreferrer">UDISE via India Data Portal (ODC-By)</a> · <a href="https://github.com/BrahmjotSingh0/aishe-institutions-list" target="_blank" rel="noreferrer">AISHE snapshot © Brahmjot Singh (MIT)</a>.</small>
  </div>;
}
