import {
  ArrowRight,
  CalendarDays,
  CheckSquare2,
  ClipboardCheck,
  CreditCard,
  MessageSquareText,
  ShieldCheck,
  TicketCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { HomeAction, HomeActionKind } from "./types";
import "./home-actions.css";

const icons: Record<HomeActionKind, typeof CalendarDays> = {
  event_rsvp: TicketCheck,
  event_consent: ShieldCheck,
  event_payment: CreditCard,
  event_checklist: CheckSquare2,
  event_upcoming: CalendarDays,
  leave_signature: ShieldCheck,
  diary_acknowledgement: MessageSquareText,
  attendance_register: ClipboardCheck,
  attendance_followup: MessageSquareText,
  event_duty: CalendarDays,
};

function dateLabel(action: HomeAction) {
  const value = action.due_at ?? action.occurs_at;
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const includesMeaningfulTime = /T\d{2}:\d{2}/.test(value) && !/T00:00(?::00)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(value);
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: includesMeaningfulTime ? "numeric" : undefined,
    minute: includesMeaningfulTime ? "2-digit" : undefined,
  }).format(date);
}

function ActionLink({ action, primary = false, compact = false }: { action: HomeAction; primary?: boolean; compact?: boolean }) {
  const Icon = icons[action.kind];
  const className = `home-action-card is-${action.priority}${primary ? " is-primary" : ""}`;
  const formattedDate = dateLabel(action);
  const content = <>
    <span className="home-action-card__icon" aria-hidden="true"><Icon size={primary ? 21 : 18} /></span>
    <span className="home-action-card__content">
      <span className="home-action-card__meta"><b>{action.status_label}</b>{formattedDate ? <time dateTime={action.due_at ?? action.occurs_at ?? undefined}>{formattedDate}</time> : null}</span>
      <strong>{action.title}</strong>
      {!compact && action.detail ? <small>{action.detail}</small> : null}
    </span>
    <span className="home-action-card__cta">{action.action_label}<ArrowRight size={16} /></span>
  </>;
  if (action.href.startsWith("#")) {
    return <a className={className} href={action.href}>{content}</a>;
  }
  return <Link className={className} to={action.href}>{content}</Link>;
}

export function HomeActionSpotlight({ action, tone = "surface" }: { action: HomeAction; tone?: "surface" | "brand" }) {
  const Icon = icons[action.kind];
  const formattedDate = dateLabel(action);
  const className = `home-action-spotlight home-action-spotlight--${tone} is-${action.priority}`;
  const content = <>
    <span className="home-action-spotlight__icon" aria-hidden="true"><Icon size={20} /></span>
    <span className="home-action-spotlight__content">
      <span className="home-action-spotlight__meta"><b>{action.status_label}</b>{formattedDate ? <time dateTime={action.due_at ?? action.occurs_at ?? undefined}>{formattedDate}</time> : null}</span>
      <strong>{action.title}</strong>
      <small>{action.detail}</small>
    </span>
    <span className="home-action-spotlight__cta">{action.action_label}<ArrowRight size={16} aria-hidden="true" /></span>
  </>;
  return action.href.startsWith("#")
    ? <a className={className} href={action.href}>{content}</a>
    : <Link className={className} to={action.href}>{content}</Link>;
}

export function HomeActionDeck({ actions, title = "For you", variant = "default" }: { actions: HomeAction[]; title?: string; variant?: "default" | "quiet" }) {
  if (!actions.length) return null;
  const [primary, ...secondary] = actions;
  return <section className={`home-action-deck${variant === "quiet" ? " home-action-deck--quiet" : ""}`} aria-labelledby="home-action-deck-heading">
    <header>
      <div><h2 id="home-action-deck-heading">{title}</h2></div>
      <b>{actions.length}</b>
    </header>
    {primary ? <ActionLink action={primary} primary compact={variant === "quiet"} /> : null}
    {secondary.length ? <div className="home-action-deck__secondary">{secondary.map((action) => <ActionLink key={action.id} action={action} compact={variant === "quiet"} />)}</div> : null}
  </section>;
}
