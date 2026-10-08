import { useSearchParams } from "react-router-dom";
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
      <PrincipalInsightsDashboard date={date}/>
    </div>
  </OperationsShell>;
}
