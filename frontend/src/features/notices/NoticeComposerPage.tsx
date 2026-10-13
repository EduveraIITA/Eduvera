import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  createNotice, getNotice, getNoticeReferences, noticeCommandKey, updateNotice,
  type NoticeAudience, type NoticeContent, type NoticeDetail, type NoticePriority, type NoticeResponseMode,
} from "./api";
import { NoticeShell } from "./NoticeShell";

function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function NoticeComposerForm({ portal, schoolId, noticeId, initial, classes, referencesPending, detailContext }: {
  portal: "teacher" | "principal"; schoolId?: string; noticeId?: string; initial?: NoticeDetail;
  classes: Array<{ id: string; name: string }>; referencesPending: boolean; detailContext: string;
}) {
  const navigate = useNavigate(); const firstAudience = initial?.audiences[0];
  const [title, setTitle] = useState(initial?.title ?? ""); const [body, setBody] = useState(initial?.body ?? "");
  const [mode, setMode] = useState<NoticeResponseMode>(initial?.response_mode ?? "information");
  const [priority, setPriority] = useState<NoticePriority>(initial?.priority ?? "normal");
  const [dueAt, setDueAt] = useState(localDateTime(initial?.due_at)); const [options, setOptions] = useState(initial?.response_options.join("\n") ?? "");
  const [audienceKind, setAudienceKind] = useState<NoticeAudience["kind"]>(firstAudience?.kind ?? (portal === "teacher" ? "class_guardians" : "school_guardians"));
  const [classId, setClassId] = useState(firstAudience?.class_section_id ?? ""); const [error, setError] = useState("");
  const command = useRef({ fingerprint: "", key: noticeCommandKey() });
  const audience = useMemo<NoticeAudience>(() => audienceKind === "class_guardians"
    ? { kind: audienceKind, class_section_id: classId } : { kind: audienceKind }, [audienceKind, classId]);
  const mutation = useMutation({ mutationFn: async (input: NoticeContent) => {
    const fingerprint = JSON.stringify(input);
    if (command.current.fingerprint !== fingerprint) command.current = { fingerprint, key: noticeCommandKey() };
    if (noticeId && initial) return updateNotice(noticeId, input, initial.revision, command.current.key);
    if (!schoolId) throw new Error("Select a school before creating a notice.");
    return createNotice(schoolId, input, command.current.key);
  }, onSuccess: (result) => navigate(`/${portal}/notices/${result.id}${detailContext}`, { replace: true }) });

  function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    if (audience.kind === "class_guardians" && !audience.class_section_id) { setError("Choose a class."); return; }
    const responseOptions = mode === "choice" ? options.split("\n").map((item) => item.trim()).filter(Boolean) : [];
    if (mode === "choice" && responseOptions.length < 2) { setError("Add at least two choices, one per line."); return; }
    if (mode !== "information" && !dueAt) { setError("Choose a response deadline."); return; }
    const input: NoticeContent = {
      title: title.trim(), body: body.trim(), response_mode: mode, response_options: responseOptions, priority,
      due_at: mode === "information" ? null : new Date(dueAt).toISOString(), audiences: [audience],
    };
    mutation.mutate(input);
  }

  const issue = error || (mutation.error instanceof Error ? mutation.error.message : "");
  return <form onSubmit={submit}>
    {issue ? <div className="notice-inline-alert" role="alert"><AlertCircle size={18} /><span>{issue}</span></div> : null}
    <fieldset disabled={mutation.isPending || Boolean(initial && initial.status !== "draft")}>
      <label className="notice-field"><span>Title</span><input required minLength={3} maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Short and specific" /></label>
      <label className="notice-field"><span>Message</span><textarea required minLength={3} maxLength={4000} rows={7} value={body} onChange={(event) => setBody(event.target.value)} placeholder="What people need to know" /></label>
      <div className="notice-field-grid">
        <label className="notice-field"><span>Response</span><span className="notice-select"><select value={mode} onChange={(event) => { setMode(event.target.value as NoticeResponseMode); if (event.target.value === "information") setDueAt(""); }}><option value="information">Information only</option><option value="acknowledgement">Acknowledgement</option><option value="choice">Choose an option</option></select><ChevronDown size={16} /></span></label>
        <label className="notice-field"><span>Priority</span><span className="notice-select"><select value={priority} onChange={(event) => setPriority(event.target.value as NoticePriority)}><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><ChevronDown size={16} /></span></label>
      </div>
      {mode === "choice" ? <label className="notice-field"><span>Choices</span><textarea required rows={3} value={options} onChange={(event) => setOptions(event.target.value)} placeholder={"Yes\nNo"} /><small>One choice per line, up to six.</small></label> : null}
      {mode !== "information" ? <label className="notice-field"><span>Respond by</span><input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label> : null}
      <label className="notice-field"><span>Audience</span><span className="notice-select"><select value={audienceKind} onChange={(event) => setAudienceKind(event.target.value as NoticeAudience["kind"])} disabled={portal === "teacher"}><option value="class_guardians">Guardians in one class</option>{portal === "principal" ? <><option value="school_guardians">All guardians</option><option value="school_staff">All staff</option></> : null}</select><ChevronDown size={16} /></span></label>
      {audienceKind === "class_guardians" ? <label className="notice-field"><span>Class</span><span className="notice-select"><select required value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Choose class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></span></label> : null}
      <button className="notice-primary-button" type="submit" disabled={mutation.isPending || referencesPending}><Check size={18} />{mutation.isPending ? "Saving…" : "Save draft"}</button>
    </fieldset>
  </form>;
}

export function NoticeComposerPage({ portal, noticeId }: { portal: "teacher" | "principal"; noticeId?: string }) {
  const auth = useAuth(); const role = portal === "principal" ? "admin" : "staff";
  const [params] = useSearchParams();
  const schoolId = auth.memberships.find((membership) => membership.role === role)?.school_id;
  const existing = useQuery({ queryKey: ["notice", portal, noticeId], queryFn: () => getNotice(portal, noticeId!), enabled: Boolean(noticeId) });
  const references = useQuery({ queryKey: ["notice-references", portal, schoolId], queryFn: () => getNoticeReferences(portal, schoolId), enabled: Boolean(schoolId) });
  const loading = Boolean(noticeId) && existing.isPending;
  const issue = existing.error instanceof Error ? existing.error.message : references.error instanceof Error ? references.error.message : "";
  const listView=params.get("view");
  const detailContext=["attention","published","draft","cancelled"].includes(listView??"")?`?view=${encodeURIComponent(listView!)}`:"";
  const listBack=`/${portal}/notices${detailContext}`;
  return <NoticeShell portal={portal} title={noticeId ? "Edit notice" : "New notice"} backTo={noticeId ? `/${portal}/notices/${noticeId}${detailContext}` : listBack}>
    <div className="notices-workspace notice-compose">
      {loading ? <div className="notice-loading" role="status"><span /><span /></div>
        : issue ? <div className="notice-inline-alert" role="alert"><AlertCircle size={18} /><span>{issue}</span></div>
          : <NoticeComposerForm key={existing.data?.id ?? "new"} portal={portal} schoolId={schoolId} noticeId={noticeId} initial={existing.data} classes={references.data?.classes ?? []} referencesPending={references.isPending} detailContext={detailContext} />}
    </div>
  </NoticeShell>;
}
