import { useState, type FormEvent } from "react";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { askVisitQuestion, replyToVisitQuestion, type SharedVisitDetail } from "./visitSharingApi";
import { useVisitSharingCommand, VisitSharingFeedback } from "./useVisitSharingCommand";
import { visitDate } from "./VisitPrimitives";

export function VisitQuestions({ schoolId, detail, timezone, disabled, refresh }: {
  schoolId: string; detail: SharedVisitDetail; timezone: string; disabled: boolean; refresh: () => Promise<unknown>;
}) {
  const { visit, share, question } = detail, reply = share.can_reply, canWrite = reply || share.can_ask;
  const [note, setNote] = useState(""), [sent, setSent] = useState("");
  const write = useVisitSharingCommand<SharedVisitDetail>({ schoolId, visitId: visit.id,
    accepts: receipt => receipt.action === (reply ? "replied" : "asked") && receipt.share_id === share.id && receipt.share_root_id === share.root_id && (!reply || receipt.question_id === question?.id),
    onAccepted: async result => { if (result && (result.visit.id !== visit.id || result.share.root_id !== share.root_id || !result.question || reply && result.question.id !== question?.id)) throw new Error("The saved message could not be matched to this visit. Check its result."); await refresh(); setNote(""); setSent(reply ? "Reply sent." : "Question sent."); },
  });
  useUnsavedChangesGuard(Boolean(note.trim()) && !write.recovery, "Discard this unsent visit message?");
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (disabled || write.locked || !canWrite || note.trim().length < 3) return;
    const body = { expected_revision: question?.revision ?? 0, note: note.trim() };
    void write.execute(command_id => reply && question ? replyToVisitQuestion(schoolId, visit.id, question.id, { ...body, command_id }) : askVisitQuestion(schoolId, visit.id, { ...body, command_id, share_id: share.id }), body.expected_revision);
  };
  return <section className="visits-section" aria-labelledby="visit-questions-title"><header><h2 id="visit-questions-title">Questions</h2>{question ? <span className="visits-caption">{question.state === "answered" ? "Answered" : question.state === "withdrawn" ? "No reply pending" : reply ? "Reply needed" : "Waiting for campus reply"}</span> : null}</header>
    {question?.entries.length ? <ol className="visits-conversation">{question.entries.map(entry => <li key={entry.id} className={`is-${entry.author}`}><header><strong>{entry.author_label}</strong><time dateTime={entry.recorded_at}>{visitDate(entry.recorded_at, timezone)}</time></header><p>{entry.note}</p></li>)}</ol> : <p className="visits-caption">Ask about this visit here.</p>}
    {question?.entries_has_more ? <p className="visits-caption">Showing the latest 50 messages.</p> : null}
    {!share.owner.available ? <p className="visits-caption">The person answering questions is unavailable. The campus needs to assign someone to answer.</p> : <p className="visits-caption">{reply ? "Your reply goes to this organiser only." : `Questions go to ${share.owner.label}.`}</p>}
    {sent ? <p className="visits-saved" role="status">{sent}</p> : null}
    {canWrite ? <form className="visits-message" onSubmit={submit}><label htmlFor="visit-question-note">{reply ? "Your reply" : question ? "Ask a follow-up" : "Your question"}</label><textarea id="visit-question-note" rows={3} required minLength={3} maxLength={2000} value={note} disabled={disabled || write.locked} onChange={event => { setNote(event.target.value); setSent(""); }} /><VisitSharingFeedback write={write} onReview={async () => { await refresh(); write.reviewed(); }} /><button type="submit" disabled={disabled || write.locked || note.trim().length < 3}>{write.busy ? "Sending…" : reply ? "Send reply" : "Send question"}</button></form> : null}
  </section>;
}
