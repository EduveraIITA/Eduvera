import { Activity, ArrowRight } from 'lucide-react';
import '../student-pulse/student-pulse.css';
import { Link, useSearchParams } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { schoolDateToday } from "../../lib/schoolTime";
import { PrincipalInsightsDashboard } from "./PrincipalInsightsDashboard";

export function PrincipalInsightsPage() {
  const [params, setParams] = useSearchParams();
  const date = params.get("date") ?? schoolDateToday();
  return <OperationsShell portal="principal" active="insights" title="Insights">
    <div className="operations-stack">
      <div className="principal-insights__filters principal-insights__date">
        <label>Review ending on<input type="date" value={date} onChange={event => {
          if (!event.target.value) return;
          setParams(previous => { const next = new URLSearchParams(previous); next.set("date", event.target.value); return next; });
        }}/></label>
      </div>
      <Link className="pulse-entry" to="/principal/student-pulse"><Activity size={22}/><span><strong>Student Pulse</strong><small>Who needs a supportive check-in? Review subject attendance gaps and follow-through.</small></span><ArrowRight size={18}/></Link>
      <PrincipalInsightsDashboard date={date}/>
    </div>
  </OperationsShell>;
}
