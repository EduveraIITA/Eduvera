import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspaceManifest } from "../workspace/useWorkspaceManifest";

export function TransportAttention() {
  const query = useWorkspaceManifest();
  if (query.isPending) return <p className="departure-empty" role="status">Checking transport attention…</p>;
  if (query.isError) return <div className="departure-attention-state" role="alert">Transport attention could not be loaded. <button onClick={() => void query.refetch()}>Retry</button></div>;
  const items = query.data?.work.items.filter((item) => item.href.startsWith("/areas/departure/")) ?? [];
  if (!items.length) return null;
  return <section className="departure-panel transport-attention" aria-label="Transport needing attention">
    <h2>Needs attention</h2>
    <nav aria-label="Transport attention items">{items.map(item => <Link key={item.id} to={item.href}>
      <span><strong>{item.title}</strong>{item.status_label ? <small>{item.status_label}</small> : null}{item.due_label ? <small>{item.due_label}</small> : null}</span>
      <ChevronRight size={18} aria-hidden="true"/>
    </Link>)}</nav>
  </section>;
}
