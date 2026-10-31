import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, Check, ChevronDown } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  createNotice, getNotice, getNoticeReferences, getWorkspaceNotice, getWorkspaceNoticeReferences, noticeCommandKey, updateNotice,
  type NoticeAudience, type NoticeContent, type NoticeDetail, type NoticePortal, type NoticePriority, type NoticeResponseMode,
} from "./api";
import { NoticeShell } from "./NoticeShell";
import {
  noticeDetailPath,
  noticeListPath,
  type NoticeExperienceContext,
  type NoticeWorkspaceContext,
} from "./noticeWorkspaceContext";

import { TemporalInput } from "../../components/forms/TemporalInput";
function localDateTime(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function withView(path: string, view: string | null | undefined, page?: string | null) {
  const destination = new URL(path, "https://thatcampus.invalid");
  if (view && ["attention", "published", "draft", "cancelled"].includes(view)) destination.searchParams.set("view", view);
  if (page && /^\d+$/.test(page) && Number(page) > 1) destination.searchParams.set("updates_page", page);
  return `${destination.pathname}${destination.search}`;
}

const audienceLabels: Record<NoticeAudience["kind"], string> = {
  class_guardians: "Guardians in one class",
  school_guardians: "All guardians",
  school_staff: "All staff",
};

function NoticeComposerForm({ context, schoolId, noticeId, initial, classes, allowedAudienceKinds, referencesPending, listView, listPage }: {
  context: NoticeExperienceContext; schoolId?: string; noticeId?: string; initial?: NoticeDetail;
  classes: Array<{ id: string; name: string }>; allowedAudienceKinds: NoticeAudience["kind"][]; referencesPending: boolean; listView?: string | null; listPage?: string | null;
}) {
  const navigate = useNavigate(); const firstAudience = initial?.audiences[0];
  const [title, setTitle] = useState(initial?.title ?? ""); const [body, setBody] = useState(initial?.body ?? "");
  const [mode, setMode] = useState<NoticeResponseMode>(initial?.response_mode ?? "information");
  const [priority, setPriority] = useState<NoticePriority>(initial?.priority ?? "normal");
  const [dueAt, setDueAt] = useState(localDateTime(initial?.due_at)); const [options, setOptions] = useState(initial?.response_options.join("\n") ?? "");
  const [audienceKind, setAudienceKind] = useState<NoticeAudience["kind"]>(firstAudience?.kind ?? allowedAudienceKinds[0] ?? "class_guardians");
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
  }, onSuccess: (result) => navigate(withView(noticeDetailPath(context, result.id), listView, listPage), { replace: true }) });

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
      {mode !== "information" ? <label className="notice-field"><span>Respond by</span><TemporalInput required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label> : null}
      <label className="notice-field"><span>Audience</span><span className="notice-select"><select value={audienceKind} onChange={(event) => setAudienceKind(event.target.value as NoticeAudience["kind"])} disabled={allowedAudienceKinds.length <= 1}>{allowedAudienceKinds.map((kind) => <option key={kind} value={kind}>{audienceLabels[kind]}</option>)}</select><ChevronDown size={16} /></span></label>
      {audienceKind === "class_guardians" ? <label className="notice-field"><span>Class</span><span className="notice-select"><select required value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Choose class</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={16} /></span></label> : null}
      <button className="notice-primary-button" type="submit" disabled={mutation.isPending || referencesPending}><Check size={18} />{mutation.isPending ? "Saving…" : "Save draft"}</button>
    </fieldset>
  </form>;
}

type NoticeComposerPageProps =
  | { readonly portal: Exclude<NoticePortal, "parent">; readonly workspace?: never; readonly noticeId?: string }
  | { readonly portal?: never; readonly workspace: NoticeWorkspaceContext; readonly noticeId?: string };

export function NoticeComposerPage(props: NoticeComposerPageProps) {
  const { noticeId } = props;
  const context: NoticeExperienceContext = props.workspace
    ? { kind: "workspace", workspace: props.workspace }
    : { kind: "legacy", portal: props.portal };
  const auth = useAuth();
  const role = context.kind === "legacy" && context.portal === "principal" ? "admin" : "staff";
  const [params] = useSearchParams();
  const schoolId = context.kind === "workspace"
    ? context.workspace.schoolId
    : auth.memberships.find((membership) => membership.role === role)?.school_id;
  const contextKey = context.kind === "workspace" ? context.workspace.scope : context.portal;
  const existing = useQuery({
    queryKey: ["notice", contextKey, noticeId],
    queryFn: () => context.kind === "workspace"
      ? getWorkspaceNotice(context.workspace.scope, noticeId!, context.workspace.studentId)
      : getNotice(context.portal, noticeId!),
    enabled: Boolean(noticeId),
  });
  const references = useQuery({
    queryKey: ["notice-references", contextKey, schoolId],
    queryFn: () => context.kind === "workspace"
      ? getWorkspaceNoticeReferences(schoolId)
      : getNoticeReferences(context.portal as Exclude<NoticePortal, "parent">, schoolId),
    enabled: Boolean(schoolId),
  });
  const loading = Boolean(noticeId) && existing.isPending;
  const issue = existing.error instanceof Error ? existing.error.message : references.error instanceof Error ? references.error.message : "";
  const listView=params.get("view");
  const listPath = noticeListPath(context);
  const listDestination = new URL(listPath, "https://thatcampus.invalid");
  if (listView && ["attention", "published", "draft", "cancelled"].includes(listView)) listDestination.searchParams.set("view", listView);
  const listBack = withView(`${listDestination.pathname}${listDestination.search}`, listView, params.get("updates_page"));
  const detailBack = noticeId ? withView(noticeDetailPath(context, noticeId), listView, params.get("updates_page")) : listBack;
  const fallbackAudienceKinds: NoticeAudience["kind"][] = context.kind === "legacy" && context.portal === "principal"
    ? ["class_guardians", "school_guardians", "school_staff"]
    : ["class_guardians"];
  const allowedAudienceKinds = references.data?.audience_kinds ?? fallbackAudienceKinds;
  return <NoticeShell context={context} title={noticeId ? `Edit ${context.kind === "workspace" ? "update" : "notice"}` : `New ${context.kind === "workspace" ? "update" : "notice"}`} backTo={detailBack}>
    <div className="notices-workspace notice-compose">
      {loading ? <div className="notice-loading" role="status"><span /><span /></div>
        : issue ? <div className="notice-inline-alert" role="alert"><AlertCircle size={18} /><span>{issue}</span></div>
          : <NoticeComposerForm key={existing.data?.id ?? "new"} context={context} schoolId={schoolId} noticeId={noticeId} initial={existing.data} classes={references.data?.classes ?? []} allowedAudienceKinds={allowedAudienceKinds} referencesPending={references.isPending} listView={listView} listPage={params.get("updates_page")} />}
    </div>
  </NoticeShell>;
}
