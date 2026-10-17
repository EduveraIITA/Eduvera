import { lazy, Suspense } from "react";
import { Activity, CalendarDays, Check, ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { useOptionalAuth } from "../auth/AuthContext";
import { setTimetableExperience, useTimetableExperience, type TimetableExperience } from "./timetableExperience";
import "./experimental-settings.css";

const CampusLabControl = import.meta.env.DEV ? lazy(() => import("../../dev/campus-lab/CampusLabControl")) : null;

const options: Array<{ id: TimetableExperience; name: string; description: string; badge?: string }> = [
  { id: "current", name: "Current", description: "The proven timetable and calendar, kept as the default." },
  { id: "timeline", name: "Timeline", description: "A Teams-inspired day and week canvas with positional planning.", badge: "Experimental" },
];

export default function ExperimentalSettingsPage() {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? "anonymous";
  const selected = useTimetableExperience(userId);
  return <OperationsShell portal="principal" active="more" title="Experimental settings" backTo="/principal/more">
    <div className="experimental-settings">
      <section aria-labelledby="timetable-experience-title">
        <header>
          <span aria-hidden="true"><CalendarDays size={20} /></span>
          <div><h2 id="timetable-experience-title">Timetable experience</h2><p>Choose the interface used for Timetable and Calendar on this device.</p></div>
        </header>
        <div className="experimental-settings__choices" role="radiogroup" aria-label="Timetable experience">
          {options.map((option) => <button key={option.id} type="button" role="radio" aria-checked={selected === option.id} onClick={() => setTimetableExperience(userId, option.id)}>
            <span><strong>{option.name}{option.badge ? <em>{option.badge}</em> : null}</strong><small>{option.description}</small></span>
            <i aria-hidden="true">{selected === option.id ? <Check size={16} /> : null}</i>
          </button>)}
        </div>
        <p className="experimental-settings__note">You can switch back at any time. Your timetable data is shared; only the interface changes.</p>
      </section>
      {import.meta.env.DEV ? <section className="experimental-settings__lab" aria-labelledby="synthetic-school-day-title">
        <header>
          <span aria-hidden="true"><Activity size={20} /></span>
          <div><h2 id="synthetic-school-day-title">Synthetic school day</h2><p>Cambridge's dummy students, staff and families perform normal app work on this local server.</p></div>
        </header>
        {CampusLabControl ? <Suspense fallback={<p className="experimental-settings__control-loading">Checking simulation…</p>}><CampusLabControl /></Suspense> : null}
        <Link to="/principal/campus"><span><strong>See synthetic activity in Campus view</strong><small>The development actors appear as an explicitly simulated layer over the normal admin feature.</small></span><ChevronRight size={19} /></Link>
        <p className="experimental-settings__note">Development only. Campus View itself is a permanent admin feature and does not depend on this simulation.</p>
      </section> : null}
    </div>
  </OperationsShell>;
}
