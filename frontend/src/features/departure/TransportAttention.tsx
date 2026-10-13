import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAttention } from "../attention/useAttention";

export function TransportAttention() {
  const query = useAttention("principal");
  if (query.isPending) return <p className="departure-empty" role="status">Checking transport attention…</p>;
  if (query.isError) return <div className="departure-attention-state" role="alert">Transport attention could not be loaded. <button onClick={() => void query.refetch()}>Retry</button></div>;
  const items = query.data?.items.filter(item => item.module === "departure" || item.module === "transport") ?? [];
  if (!items.length) return null;
  const timezone = query.data?.scope?.timezone ?? "Asia/Kolkata";
  return <section className="departure-panel transport-attention" aria-label="Transport needing attention">
    <h2>Needs attention</h2>
    <nav aria-label="Transport attention items">{items.map(item => <Link key={item.id} to={item.href}>
      <span><strong>{item.title}</strong><small>{item.status_label}</small>{item.due_at ? <small>{new Date(item.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: timezone })}</small> : null}</span>
      <ChevronRight size={18} aria-hidden="true"/>
    </Link>)}</nav>
  </section>;
}
