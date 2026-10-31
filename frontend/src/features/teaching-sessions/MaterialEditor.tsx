import { useState } from "react";
import { InfoSummary } from "../../components/InfoSummary";
import { PlannerDialog } from "../planner/PlannerLessonSheet";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { addTeachingMaterial, uploadTeachingMaterial, type TeachingMaterial, type TeachingSessionDetail } from "./api";
import { useTeachingSessionWrite } from "./useTeachingSessionWrite";

export function MaterialEditor({ data, initial, refresh, onClose, onAccessLost }: { data: TeachingSessionDetail; initial?: TeachingMaterial; refresh: () => Promise<TeachingSessionDetail>; onClose: () => void; onAccessLost?: () => void }) {
  const [source, setSource] = useState(data), [kind, setKind] = useState<"file" | "link" | "text">(initial?.kind ?? "file"), [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? ""), [body, setBody] = useState(initial?.body ?? ""), [file, setFile] = useState<File | null>(null), [shared, setShared] = useState(initial?.shared ?? true);
  const [materialId] = useState(() => crypto.randomUUID()), [reviewing, setReviewing] = useState(false), [current, setCurrent] = useState<TeachingSessionDetail | null>(null), [reviewError, setReviewError] = useState("");
  const write = useTeachingSessionWrite(refresh, onAccessLost), disabled = write.busy || write.locked || reviewing;
  const guard = useUnsavedChangesGuard(Boolean(title || url || body || file) || write.busy || write.locked, "Leave this resource? Keep this screen while an unconfirmed upload is resolved.");
  const save = async () => {
    if (disabled) return;
    const envelope = { expected_revision: source.lesson.revision, source_fingerprint: source.session.source_fingerprint, material_id: materialId, title: title.trim(), shared, ...(initial ? { replaces_material_id: initial.id } : {}) };
    const accepted = await write.run(JSON.stringify({ ...envelope, kind, url, body, file: file ? [file.name, file.size, file.lastModified] : null }), command_id => {
      if (kind !== "file") return addTeachingMaterial(source.session.id, source.session.date, { ...envelope, command_id, kind, ...(kind === "link" ? { url: url.trim() } : { body }) });
      const form = new FormData(); Object.entries({ ...envelope, command_id }).forEach(([key, value]) => form.set(key, String(value))); form.set("file", file!);
      return uploadTeachingMaterial(source.session.id, source.session.date, form);
    }, { sourceId: source.session.id, revision: source.lesson.revision, fingerprint: source.session.source_fingerprint });
    if (accepted) onClose();
  };
  const review = async () => {
    setReviewing(true); setReviewError("");
    try { const fresh = await refresh(); if (fresh.capabilities.can_manage && fresh.session.state === "expected") setCurrent(fresh); else setReviewError("Your permission to add resources ended. Nothing was sent again."); }
    catch { setReviewError("The current session could not load. Your resource is kept here."); }
    finally { setReviewing(false); }
  };
  const validUrl = (() => { try { const parsed = new URL(url); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; } })();
  return <PlannerDialog title={initial ? "New resource version" : "Add resource"} busy={write.busy || reviewing} onClose={() => { if (!write.busy && !reviewing && guard()) onClose(); }}>
    <form className="teaching-session-form" onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={disabled}>
        <div className="teaching-choices" role="group" aria-label="Resource type">{(["file", "link", "text"] as const).map(value => <button type="button" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>{value === "file" ? "File" : value === "link" ? "Link" : "Text / code"}</button>)}</div>
        <label>Title<input autoFocus required maxLength={180} value={title} onChange={event => setTitle(event.target.value)} /></label>
        {kind === "file" ? <label className="teaching-file-input">File<input type="file" required accept=".pdf,.png,.jpg,.jpeg,.txt,.md,.csv,.py,.js,.ts,.java,.c,.cpp,.html,.css" onChange={event => { const value = event.target.files?.[0] ?? null; setFile(value); if (value && !title) setTitle(value.name); }} /></label> : kind === "link" ? <label>Web address<input required type="url" inputMode="url" autoComplete="url" maxLength={1000} placeholder="https://" value={url} onChange={event => setUrl(event.target.value)} /></label> : <label>Text or example code<textarea required rows={7} maxLength={20000} value={body} onChange={event => setBody(event.target.value)} /></label>}
        <label className="teaching-checkbox"><input type="checkbox" checked={shared} onChange={event => setShared(event.target.checked)} /><span>Share with session participants</span></label>
      </fieldset>
      <p className="teaching-caption">{shared ? "Available to the people in this session. Private assignment work stays separate." : "Only authorized instructors can open this resource."}</p>
      <details><InfoSummary>Resource details</InfoSummary><p className="teaching-caption">PDF, PNG, JPEG or UTF-8 text/code · 5 MiB per file · 50 resource versions per session. Earlier versions are retained. Adding a resource does not submit an assignment or confirm teaching.</p></details>
      {write.error ? <p className="teaching-error" role="alert">{write.error}</p> : null}
      {write.recovery === "unknown" || write.recovery === "accepted" ? <button type="button" disabled={write.busy} onClick={() => { void write.recover().then(saved => { if (saved) onClose(); }); }}>{write.recovery === "unknown" ? "Retry same action" : "Refresh saved session"}</button> : null}
      {write.recovery === "obsolete" ? <button type="button" disabled={reviewing} onClick={() => void review()}>Review current session</button> : null}
      {reviewError ? <p role="alert">{reviewError}</p> : null}
      {current ? <section className="teaching-review"><h3>Current session</h3><strong>{current.session.title}</strong><p className="teaching-caption">{current.session.place_label ?? "Place not assigned"} · {current.session.teacher_name ?? "Teacher not assigned"}</p><button type="button" onClick={() => { setSource(current); setCurrent(null); write.resolveObsolete(); }}>Continue with this session</button></section> : null}
      <footer className="teaching-actions"><button type="button" disabled={write.busy || reviewing} onClick={() => { if (guard()) onClose(); }}>Cancel</button><button type="submit" className="is-primary" disabled={disabled || !title.trim() || (kind === "file" ? !file : kind === "link" ? !validUrl : !body.trim())}>{write.busy ? "Saving…" : initial ? "Add version" : "Add resource"}</button></footer>
    </form>
  </PlannerDialog>;
}
