import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { saveCoveragePolicy, type AdminStaffWorkspace } from "../staff-operations/api";
import "./operating-rules.css";

const formValue = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
};

const staffName = (profile: AdminStaffWorkspace["profiles"][number]) =>
  [profile.first_name, profile.last_name].filter(Boolean).join(" ");
export function CoverageOperatingRules({ schoolId, data, refresh }: { schoolId: string; data: AdminStaffWorkspace; refresh: () => Promise<void> }) {
  const [savingCoverage, setSavingCoverage] = useState(false);
  const [error, setError] = useState("");
  const coveragePolicy = data.coverage_policy ?? {
    school_id: schoolId,
    enabled: false,
    deadline_minutes_before: 30,
    fallback_kind: "independent_study" as const,
    fallback_label: "Independent study",
    supervisor_staff_profile_id: null,
    supervisor_first_name: null,
    supervisor_last_name: null,
    revision: 0,
  };
  const [enabled, setEnabled] = useState(coveragePolicy.enabled);

  const saveFallback = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingCoverage(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await saveCoveragePolicy(schoolId, {
        enabled: form.has("enabled"),
        deadline_minutes_before: Number(formValue(form, "deadline_minutes_before")),
        fallback_kind: formValue(form, "fallback_kind") as typeof coveragePolicy.fallback_kind,
        fallback_label: formValue(form, "fallback_label"),
        supervisor_staff_profile_id: formValue(form, "supervisor_staff_profile_id") || null,
        expected_revision: coveragePolicy.revision,
      });
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSavingCoverage(false);
    }
  };
  return (
    <form className="coverage-rule" onSubmit={(event) => void saveFallback(event)}>
      <header className="coverage-rule__header">
        <div>
          <h2>Leave cover</h2>
          <p>Set the automatic plan for unfilled classes.</p>
        </div>
        <label className="rule-switch">
          <span className="sr-only">Automatic fallback</span>
          <input name="enabled" type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span className="rule-switch__track" aria-hidden="true"><span /></span>
        </label>
      </header>

      <div className="coverage-rule__group">
        <label className="coverage-rule__row">
          <span><strong>Decision time</strong><small>Before the class begins</small></span>
          <select name="deadline_minutes_before" defaultValue={coveragePolicy.deadline_minutes_before}>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="1440">1 day</option>
          </select>
        </label>
        <label className="coverage-rule__row">
          <span><strong>Fallback plan</strong><small>Used when no cover is assigned</small></span>
          <select name="fallback_kind" defaultValue={coveragePolicy.fallback_kind}>
            <option value="independent_study">Independent study</option>
            <option value="physical_activity">Games / physical activity</option>
            <option value="library_period">Library period</option>
            <option value="merge_class">Merge with another class</option>
            <option value="cancelled_period">Cancel period</option>
          </select>
        </label>
        <label className="coverage-rule__row">
          <span><strong>Staff label</strong><small>Shown on the timetable</small></span>
          <input name="fallback_label" defaultValue={coveragePolicy.fallback_label} required minLength={3} maxLength={120} />
        </label>
        <label className="coverage-rule__row">
          <span><strong>Responsible team</strong><small>Optional</small></span>
          <select name="supervisor_staff_profile_id" defaultValue={coveragePolicy.supervisor_staff_profile_id ?? ""}>
            <option value="">School duty team</option>
            {data.profiles.filter((profile) => profile.status === "active" && profile.user_id).map((profile) => (
              <option value={profile.id} key={profile.id}>{staffName(profile)} · {profile.designation}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="coverage-rule__note"><Info size={16} aria-hidden="true" /><p>This records the planned fallback, not whether the activity happened.</p></div>
      {error ? <p className="coverage-rule__error" role="alert">{error}</p> : null}
      <button className="coverage-rule__save" disabled={savingCoverage}>
        {savingCoverage ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
