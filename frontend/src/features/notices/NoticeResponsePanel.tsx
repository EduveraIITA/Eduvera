import { useMutation } from "@tanstack/react-query";
import { Check, CircleCheck, Clock3, Send } from "lucide-react";
import { useRef, useState } from "react";
import { noticeCommandKey, respondToNotice, type NoticeDetail, type NoticeRecipient } from "./api";

export function NoticeResponsePanel({ notice, recipient, studentId, onSaved }: {
  notice: NoticeDetail; recipient: NoticeRecipient; studentId?: string; onSaved: () => Promise<unknown>;
}) {
  const [choice, setChoice] = useState(""); const command = useRef(noticeCommandKey());
  const [renderedAt] = useState(Date.now);
  const mutation = useMutation({ mutationFn: () => respondToNotice(notice.id, {
    expected_revision: recipient.revision, response_value: notice.response_mode === "choice" ? choice : undefined, student_id: studentId,
  }, command.current), onSuccess: async () => { await onSaved(); } });
  if (notice.status !== "published" || notice.response_mode === "information") {
    return <div className="notice-response notice-response--quiet"><Check size={18} /><span>No response needed</span></div>;
  }
  if (recipient.responded_at) {
    return <div className="notice-response notice-response--done"><CircleCheck size={20} /><span><b>{notice.response_mode === "choice" ? recipient.response_value : "Acknowledged"}</b><small>Recorded {new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(recipient.responded_at))}</small></span></div>;
  }
  if (notice.due_at && new Date(notice.due_at).getTime() < renderedAt) {
    return <div className="notice-response notice-response--quiet"><Clock3 size={18} /><span>The response period has ended.</span></div>;
  }
  return <section className="notice-response" aria-label="Your response">
    {notice.response_mode === "choice" ? <div className="notice-choice-list">{notice.response_options.map((option) => <label key={option}><input type="radio" name={`notice-${notice.id}`} value={option} checked={choice === option} onChange={() => setChoice(option)} /><span>{option}</span></label>)}</div> : <p>Confirm that you have read this notice.</p>}
    {mutation.error ? <p className="notice-form-error" role="alert">{mutation.error instanceof Error ? mutation.error.message : "The response could not be saved."}</p> : null}
    <button className="notice-primary-button" type="button" disabled={mutation.isPending || (notice.response_mode === "choice" && !choice)} onClick={() => mutation.mutate()}><Send size={17} />{mutation.isPending ? "Saving…" : notice.response_mode === "choice" ? "Submit response" : "Acknowledge"}</button>
  </section>;
}
