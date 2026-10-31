import { UserRound } from "lucide-react";
import type { GateActivity } from "./api";

function timeLabel(value: string, hindi: boolean) {
  return new Intl.DateTimeFormat(hindi ? "hi-IN" : "en-IN", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function GateActivityList({ items, hindi = false, limit }: { items: readonly GateActivity[]; hindi?: boolean; limit?: number }) {
  const visible = typeof limit === "number" ? items.slice(0, limit) : items;
  if (!visible.length) return <p className="gate-activity-empty" role="status">{hindi ? "दर्ज की गई गतिविधि यहाँ दिखाई देगी।" : "Recorded entry and exit activity will appear here."}</p>;
  return <div className="gate-activity-list" aria-label={hindi ? "हाल की गतिविधि" : "Recent In & Out records"}>{visible.map((item) => <article className="gate-activity-row" key={`${item.kind}:${item.id}`}>
    <span className="gate-activity-avatar">{item.avatar_url ? <img src={item.avatar_url} alt="" /> : <UserRound size={18} aria-hidden="true" />}</span>
    <span className="gate-activity-person"><strong>{item.name}</strong><small>{item.detail || item.kind}</small></span>
    <time dateTime={item.occurred_at}>{timeLabel(item.occurred_at, hindi)}</time>
    <span className={`gate-activity-direction is-${item.direction}`}><span aria-hidden="true">●</span>{item.direction === "in" ? (hindi ? "अंदर" : "In") : (hindi ? "बाहर" : "Out")}</span>
  </article>)}</div>;
}
