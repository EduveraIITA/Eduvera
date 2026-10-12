import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, FileWarning, Pencil, RefreshCw, Send, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  cancelNotice, getNotice, noticeCommandKey, openNotice, publishNotice,
  type NoticePortal,
} from "./api";
import { NoticeRecipientRow } from "./NoticeRecipientRow";
import { NoticeResponsePanel } from "./NoticeResponsePanel";
import { NoticeShell } from "./NoticeShell";

function formatDate(value: string | null, includeTime = true) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}) }).format(new Date(value));
}

function modeLabel(mode: string) {
  if (mode === "information") return "Information";
  if (mode === "acknowledgement") return "Acknowledgement";
  return "Choice";
}

export function NoticeDetailPage({ portal, noticeId }: { portal: NoticePortal; noticeId: string }) {
  const [params] = useSearchParams();
  const studentId = portal === "parent" ? params.get("student_id") ?? undefined : undefined;
  const query = useQuery({ queryKey: ["notice", portal, noticeId, studentId], queryFn: () => getNotice(portal, noticeId, studentId), staleTime: 10_000 });
  const opened = useRef<string | null>(null); const publishKey = useRef(noticeCommandKey()); const cancelKey = useRef(noticeCommandKey());
  const [cancelReason, setCancelReason] = useState("");
  const publishMutation = useMutation({ mutationFn: (revision: number) => publishNotice(noticeId, revision, publishKey.current), onSuccess: async () => { await query.refetch(); } });
  const cancelMutation = useMutation({ mutationFn: (revision: number) => cancelNotice(noticeId, revision, cancelReason.trim(), cancelKey.current), onSuccess: async () => { await query.refetch(); } });
  const data = query.data; const ownRecipient = data?.recipient ?? data?.self_recipient ?? undefined;
  useEffect(() => {
    if (!data || !ownRecipient || ownRecipient.opened_at || opened.current === ownRecipient.id || data.status === "draft") return;
    opened.current = ownRecipient.id;
    void openNotice(data.id, studentId).then(() => query.refetch()).catch(() => { opened.current = null; });
  }, [data, ownRecipient, query, studentId]);
  const backTo = `/${portal}/notices${studentId ? `?student_id=${encodeURIComponent(studentId)}` : ""}`;
  if (query.isPending) return <NoticeShell portal={portal} title="Notice" backTo={backTo} studentId={studentId}><div className="notices-workspace"><div className="notice-loading" role="status"><span /><span /><span /></div></div></NoticeShell>;
  if (query.isError || !data) return <NoticeShell portal={portal} title="Notice" backTo={backTo} studentId={studentId}><div className="notices-workspace"><section className="notice-state notice-state--error" role="alert"><AlertCircle size={24} /><strong>Notice is unavailable</strong><p>{query.error instanceof Error ? query.error.message : "It may no longer be available."}</p><button type="button" onClick={() => void query.refetch()}><RefreshCw size={16} />Try again</button></section></div></NoticeShell>;
  const actionError = publishMutation.error ?? cancelMutation.error;
  const save = () => query.refetch();
  return <NoticeShell portal={portal} title="Notice" backTo={backTo} studentId={studentId}>
    <article className="notices-workspace notice-detail">
      <header className="notice-detail__header">
        <div className="notice-detail__eyebrow"><span className={`notice-priority notice-priority--${data.priority}`}>{data.priority}</span><span>{modeLabel(data.response_mode)}</span>{data.status !== "published" ? <span>{data.status}</span> : null}</div>
        <h1>{data.title}</h1>
        <div className="notice-detail__dates">{data.published_at ? <span>Published {formatDate(data.published_at)}</span> : <span>Created {formatDate(data.created_at)}</span>}{data.due_at ? <span><Clock3 size={14} />Respond by {formatDate(data.due_at)}</span> : null}</div>
      </header>
      {data.status === "cancelled" ? <div className="notice-cancelled"><FileWarning size={18} /><span><b>Cancelled</b>{data.cancellation_reason}</span></div> : null}
      <div className="notice-detail__body">{data.body.split("\n").map((line, index) => <p key={`${index}-${line}`}>{line || <br />}</p>)}</div>

      {ownRecipient ? <NoticeResponsePanel notice={data} recipient={ownRecipient} studentId={studentId} onSaved={save} /> : null}

      {data.can_manage ? <>
        {data.status === "draft" ? <div className="notice-draft-actions"><Link to={`/${portal}/notices/${data.id}/edit`}><Pencil size={17} />Edit</Link><button type="button" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate(data.revision)}><Send size={17} />{publishMutation.isPending ? "Publishing…" : "Publish"}</button></div> : null}
        {actionError ? <p className="notice-form-error" role="alert">{actionError instanceof Error ? actionError.message : "The notice could not be updated."}</p> : null}
        {data.metrics ? <section className="notice-metrics" aria-label="Notice progress">
          <div><UsersRound size={18} /><strong>{data.metrics.recipients}</strong><span>Recipients</span></div>
          <div><CheckCircle2 size={18} /><strong>{data.metrics.opened}</strong><span>Opened</span></div>
          {data.response_mode !== "information" ? <div><Send size={18} /><strong>{data.metrics.responded}</strong><span>Responded</span></div> : null}
          {data.metrics.delivery_exceptions ? <div className="is-warning"><AlertCircle size={18} /><strong>{data.metrics.delivery_exceptions}</strong><span>Delivery issues</span></div> : null}
        </section> : null}
        {data.recipients?.length ? <section className="notice-recipients" aria-labelledby="notice-recipients-title"><div className="notice-section-heading"><h2 id="notice-recipients-title">Recipients</h2><span>{data.recipients.length}</span></div>{data.recipients.map((recipient) => <NoticeRecipientRow key={recipient.id} notice={data} recipient={recipient} onSaved={save} />)}</section> : null}
        {data.status === "published" ? <details className="notice-cancel-control"><summary>Cancel notice</summary><div><label><span>Reason</span><textarea rows={3} minLength={3} maxLength={500} value={cancelReason} onChange={(event) => { setCancelReason(event.target.value); cancelKey.current = noticeCommandKey(); }} /></label><button type="button" disabled={cancelReason.trim().length < 3 || cancelMutation.isPending} onClick={() => cancelMutation.mutate(data.revision)}>{cancelMutation.isPending ? "Cancelling…" : "Cancel notice"}</button></div></details> : null}
      </> : null}
    </article>
  </NoticeShell>;
}
