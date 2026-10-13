import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, Phone, Send, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import {
  noticeCommandKey, recordAssistedNoticeResponse, recordNoticeDelivery,
  type NoticeChannel, type NoticeDetail, type NoticeRecipient,
} from "./api";

const manualChannels: Array<{ id: Exclude<NoticeChannel, "app">; label: string }> = [
  { id: "phone", label: "Phone" }, { id: "paper", label: "Paper" }, { id: "sms", label: "SMS" }, { id: "in_person", label: "In person" },
];

export function NoticeRecipientRow({ notice, recipient, onSaved, defaultOpen = false }: { notice: NoticeDetail; recipient: NoticeRecipient; onSaved: () => Promise<unknown>; defaultOpen?: boolean }) {
  const [channel, setChannel] = useState<Exclude<NoticeChannel, "app">>("phone");
  const [choice, setChoice] = useState(""); const [note, setNote] = useState("");
  const [renderedAt] = useState(Date.now);
  const responseKey = useRef(noticeCommandKey()); const deliveryKey = useRef(noticeCommandKey());
  const response = useMutation({ mutationFn: () => recordAssistedNoticeResponse(notice.id, {
    recipient_id: recipient.id, expected_revision: recipient.revision, response_value: notice.response_mode === "choice" ? choice : undefined,
    response_note: note.trim(), channel, observed_at: new Date().toISOString(),
  }, responseKey.current), onSuccess: async () => { await onSaved(); } });
  const delivery = useMutation({ mutationFn: () => recordNoticeDelivery(notice.id, {
    recipient_id: recipient.id, channel, status: "delivered", note: note.trim(), attempted_at: new Date().toISOString(),
  }, deliveryKey.current), onSuccess: async () => { await onSaved(); } });
  const latest = recipient.deliveries[0];
  const overdue = !recipient.responded_at && notice.response_mode !== "information" && Boolean(notice.due_at && new Date(notice.due_at).getTime() < renderedAt);
  const stateLabel = recipient.responded_at ? recipient.response_value
    : latest?.status === "failed" ? "Delivery failed · follow up"
      : overdue ? "Response overdue"
        : notice.response_mode !== "information" ? "Awaiting response"
          : !recipient.opened_at ? "Delivered · not opened"
            : latest ? `${latest.channel} ${latest.status}` : "No delivery recorded";
  const mutationError = response.error ?? delivery.error;
  return <details className="notice-recipient" open={defaultOpen || undefined}>
    <summary>
      <span className={`notice-recipient__status ${recipient.responded_at ? "is-done" : latest?.status === "failed" ? "is-failed" : ""}`} aria-hidden="true">{recipient.responded_at ? <CheckCircle2 size={17} /> : latest?.status === "failed" ? <TriangleAlert size={17} /> : <span />}</span>
      <span><strong>{recipient.recipient_name}</strong><small>{recipient.student_name ? `${recipient.student_name} · ` : ""}{stateLabel}</small></span>
      <ChevronDown size={17} aria-hidden="true" />
    </summary>
    <div className="notice-recipient__detail">
      {recipient.contact_phone || recipient.contact_email ? <p>{[recipient.contact_phone, recipient.contact_email].filter(Boolean).join(" · ")}</p> : <p>No contact detail on file.</p>}
      {recipient.responded_at ? <div className="notice-response-line"><b>{recipient.response_value}</b><span>{recipient.response_channel?.replace("_", " ")}{recipient.response_note ? ` · ${recipient.response_note}` : ""}</span></div> : null}
      <div className="notice-recipient__controls">
        <label><span>Channel</span><select value={channel} onChange={(event) => { setChannel(event.target.value as Exclude<NoticeChannel, "app">); responseKey.current = noticeCommandKey(); deliveryKey.current = noticeCommandKey(); }}>{manualChannels.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        {notice.response_mode === "choice" && !recipient.responded_at ? <label><span>Response</span><select value={choice} onChange={(event) => { setChoice(event.target.value); responseKey.current = noticeCommandKey(); }}><option value="">Choose</option>{notice.response_options.map((option) => <option key={option}>{option}</option>)}</select></label> : null}
        <label className="notice-recipient__note"><span>Note (optional)</span><input maxLength={500} value={note} onChange={(event) => { setNote(event.target.value); responseKey.current = noticeCommandKey(); deliveryKey.current = noticeCommandKey(); }} /></label>
      </div>
      {mutationError ? <p className="notice-form-error" role="alert">{mutationError instanceof Error ? mutationError.message : "The update could not be saved."}</p> : null}
      <div className="notice-recipient__actions">
        <button type="button" disabled={delivery.isPending} onClick={() => delivery.mutate()}><Phone size={16} />Mark delivered</button>
        {!recipient.responded_at && notice.response_mode !== "information" ? <button className="is-primary" type="button" disabled={response.isPending || (notice.response_mode === "choice" && !choice)} onClick={() => response.mutate()}><Send size={16} />Record response</button> : null}
      </div>
    </div>
  </details>;
}
