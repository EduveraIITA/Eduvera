import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { PEOPLE_IMPORT_LIMITS } from "./peopleBulkImport";

export function PeopleNamesComposer({ names, draft, onNames, onDraft, disabled = false, action }: { names: string[]; draft: string; onNames: (names: string[]) => void; onDraft: (value: string) => void; disabled?: boolean; action?: ReactNode }) {
  const input = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const editInput = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const [editing, setEditing] = useState<number | null>(null);
  const original = useRef("");
  const [error, setError] = useState("");
  const withinLimit = (value: string) => new TextEncoder().encode([...names, value].join("\n")).byteLength <= PEOPLE_IMPORT_LIMITS.bytes;
  useEffect(() => { if (editing !== null) { editInput.current?.focus({ preventScroll: true }); editInput.current?.select(); } }, [editing]);
  useEffect(() => { if (editing === null && input.current === document.activeElement) { const field = input.current?.closest<HTMLElement>(".people-names-composer__field"); if (field) field.scrollTop = field.scrollHeight; } }, [names, editing]);
  const recognize = (text: string) => {
    if (!withinLimit(text)) { setError("Paste 1 MiB or less. Your previous names are unchanged."); return; }
    const additions = text.split(/\r\n|\r|\n/).map((value) => value.trim()).filter(Boolean);
    if (names.length + additions.length > 100) { onDraft(text); setError("Add up to 100 names at a time. Your pasted text is still here."); return; }
    onNames([...names, ...additions]); onDraft(""); setError("");
  };
  return <div className="people-names-composer" data-dialog-focus-region><div className="people-names-composer__heading"><label htmlFor={id}>Name</label>{action}</div><div className="people-names-composer__field">
    {names.map((name, index) => <div className="people-names-composer__chip" key={index}>{editing === index ? <input ref={editInput} aria-label={`Edit name ${index + 1}`} maxLength={150} value={name} disabled={disabled} onChange={(event) => onNames(names.map((value, position) => position === index ? event.target.value : value))} onBlur={() => setEditing(null)} onKeyDown={(event) => { if (event.nativeEvent.isComposing || event.keyCode === 229) return; if (event.key === "Enter") { event.preventDefault(); setEditing(null); input.current?.focus(); } else if (event.key === "Escape") { event.preventDefault(); onNames(names.map((value, position) => position === index ? original.current : value)); setEditing(null); input.current?.focus(); } }} /> : <button type="button" className="people-names-composer__name" aria-label={`Edit ${name || `name ${index + 1}`}`} disabled={disabled} onClick={() => { original.current = name; setEditing(index); }}>{name || "Blank name"}</button>}<button type="button" className="people-names-composer__remove" aria-label={`Remove ${name || `name ${index + 1}`}`} disabled={disabled} onClick={() => { onNames(names.filter((_, position) => position !== index)); setEditing(null); input.current?.focus(); }}><X size={16} aria-hidden="true" /></button></div>)}
    <textarea ref={input} id={id} aria-label="Name" aria-describedby={`${id}-hint`} autoFocus rows={1} maxLength={1024 * 1024} disabled={disabled} value={draft} placeholder={names.length ? "Add another name" : "Enter or paste names"} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onChange={(event) => { const value = event.target.value; if (!composing.current && /[\r\n]/.test(value)) recognize(value); else if (withinLimit(value)) { onDraft(value); setError(""); } else setError("Use 1 MiB or less. Your previous names are unchanged."); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) { event.preventDefault(); recognize(draft); } }} onPaste={(event) => { const text = event.clipboardData.getData("text"); const field = event.currentTarget; const combined = draft.slice(0, field.selectionStart) + text + draft.slice(field.selectionEnd); if (!withinLimit(combined)) { event.preventDefault(); setError("Paste 1 MiB or less. Your previous names are unchanged."); return; } if (/[\r\n]/.test(text)) { event.preventDefault(); recognize(combined); } }} />
  </div><p id={`${id}-hint`}>One name per line.</p>{error ? <p role="alert">{error}</p> : null}</div>;
}
