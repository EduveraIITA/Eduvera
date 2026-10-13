import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "../../lib/api";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

type AcademicMode = "daily_class" | "scheduled_session" | "none";
type CampusMode = "none" | "entry_only" | "entry_exit";
type AcademicChannel = "staff_roll_call" | "student_qr" | "camera_assisted" | "biometric_device" | "offline_paper";
type CampusChannel = "staff_entry" | "student_qr" | "camera_assisted" | "biometric_device";
type Rules = {
  revision: number;
  attendance_submission_cutoff: string;
  attendance_academic_mode: AcademicMode;
  attendance_campus_mode: CampusMode;
  attendance_academic_channels: AcademicChannel[];
  attendance_campus_channels: CampusChannel[];
  attendance_self_check_in_mode: "disabled" | "staff_review" | "automatic";
  attendance_session_open_before_minutes: number;
  attendance_session_close_after_minutes: number;
  attendance_finalization_mode: "automatic" | "principal_review";
  attendance_auto_finalize_minutes: number;
  event_entry_hours_before: number;
  event_staff_hours_after: number;
  journey_lead_minutes: number;
  message_edit_minutes: number;
  message_attachment_mb: number;
};
const fields = {
  attendance: [["attendance_submission_cutoff", "Register submission deadline", "time", 0, 0]],
  events: [["event_entry_hours_before", "Open entry before session (hours)", "number", 0, 168], ["event_staff_hours_after", "Staff entry and locking after session (hours)", "number", 0, 720]],
  departure: [["journey_lead_minutes", "Open boarding before departure (minutes)", "number", 0, 240]],
  messages: [["message_edit_minutes", "Allow editing after sending (minutes)", "number", 0, 60], ["message_attachment_mb", "Maximum attachment size (MB)", "number", 1, 10]],
} as const;
const copy = {
  attendance: "Choose what attendance means here. Academic registers and campus entry are separate records and can run together.",
  events: "Applies to all event sessions. Administrators can correct older open registers; recorded observation times still follow the observation window.",
  departure: "Journey controls open at this lead time; routine duty changes close at the same time. Rider reconciliation remains required.",
  messages: "Set editing to zero to disable it. File types and the platform’s 10 MB ceiling remain enforced.",
};

const academicChannelOptions: Array<[AcademicChannel, string, string]> = [
  ["staff_roll_call", "Staff roll call", "A teacher or authorised staff member marks the roster."],
  ["student_qr", "Student QR", "A signed-in learner checks in during the configured session window."],
  ["camera_assisted", "Camera assisted", "A reviewed camera observation supports the register."],
  ["biometric_device", "Biometric device", "A registered device submits an attendance assertion."],
  ["offline_paper", "Paper or offline", "A traceable observation can be reconciled later."],
];
const campusChannelOptions: Array<[CampusChannel, string]> = [
  ["staff_entry", "Staff-recorded entry"],
  ["student_qr", "Student QR"],
  ["camera_assisted", "Camera assisted"],
  ["biometric_device", "Biometric device"],
];

function AttendanceModelFields({ rules }: { rules: Rules }) {
  const [academicMode, setAcademicMode] = useState<AcademicMode>(rules.attendance_academic_mode);
  const [campusMode, setCampusMode] = useState<CampusMode>(rules.attendance_campus_mode);
  const [academicChannels, setAcademicChannels] = useState<AcademicChannel[]>(rules.attendance_academic_channels);
  const [campusChannels, setCampusChannels] = useState<CampusChannel[]>(rules.attendance_campus_channels);
  const toggle = <T extends string>(values: T[], value: T, checked: boolean) => checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  return <>
    <fieldset className="attendance-rule-group">
      <legend>Academic register</legend>
      <p>Determines whether presence is recorded once for the class day or for each scheduled subject.</p>
      <label className="office-field">Register scope
        <select name="attendance_academic_mode" value={academicMode} onChange={(event) => setAcademicMode(event.target.value as AcademicMode)}>
          <option value="scheduled_session">Each scheduled subject or session</option>
          <option value="daily_class">Once per class day</option>
          <option value="none">No academic register</option>
        </select>
      </label>
      {academicMode !== "none" ? <div className="attendance-rule-choices" role="group" aria-label="Academic attendance methods">
        {academicChannelOptions.map(([value, label, hint]) => <label key={value}>
          <input type="checkbox" name="attendance_academic_channels" value={value} checked={academicChannels.includes(value)} onChange={(event) => { if (!event.target.checked && academicChannels.length === 1) return; setAcademicChannels(toggle(academicChannels, value, event.target.checked)); }}/>
          <span><strong>{label}</strong><small>{hint}</small></span>
        </label>)}
      </div> : <input type="hidden" name="attendance_academic_channels" value={rules.attendance_academic_channels[0] ?? "staff_roll_call"}/>}
    </fieldset>
    <fieldset className="attendance-rule-group">
      <legend>Campus presence</legend>
      <p>Gate entry and exit are operational presence signals. They never become subject attendance automatically.</p>
      <label className="office-field">Track campus presence
        <select name="attendance_campus_mode" value={campusMode} onChange={(event) => setCampusMode(event.target.value as CampusMode)}>
          <option value="none">Not used</option>
          <option value="entry_only">Entry only</option>
          <option value="entry_exit">Entry and exit</option>
        </select>
      </label>
      {campusMode !== "none" ? <div className="attendance-rule-choices is-compact" role="group" aria-label="Campus presence methods">
        {campusChannelOptions.map(([value, label]) => <label key={value}><input type="checkbox" name="attendance_campus_channels" value={value} checked={campusChannels.includes(value)} onChange={(event) => { if (!event.target.checked && campusChannels.length === 1) return; setCampusChannels(toggle(campusChannels, value, event.target.checked)); }}/><span><strong>{label}</strong></span></label>)}
      </div> : <input type="hidden" name="attendance_campus_channels" value={rules.attendance_campus_channels[0] ?? "staff_entry"}/>}
    </fieldset>
    {academicMode !== "none" && academicChannels.some((channel) => channel !== "staff_roll_call" && channel !== "offline_paper") ? <fieldset className="attendance-rule-group">
      <legend>Student or device observations</legend>
      <p>Automatic mode records a valid observation immediately. Review mode keeps it as evidence until staff accept it.</p>
      <div className="office-form-grid">
        <label className="office-field">Resolution
          <select name="attendance_self_check_in_mode" defaultValue={rules.attendance_self_check_in_mode}>
            <option value="staff_review">Staff review</option>
            <option value="automatic">Record automatically</option>
            <option value="disabled">Do not accept self check-in</option>
          </select>
        </label>
        <label className="office-field">Open before session (minutes)<input name="attendance_session_open_before_minutes" type="number" min="0" max="240" step="1" defaultValue={rules.attendance_session_open_before_minutes}/></label>
        <label className="office-field">Close after session (minutes)<input name="attendance_session_close_after_minutes" type="number" min="0" max="1440" step="1" defaultValue={rules.attendance_session_close_after_minutes}/></label>
      </div>
    </fieldset> : <>
      <input type="hidden" name="attendance_self_check_in_mode" value={rules.attendance_self_check_in_mode}/>
      <input type="hidden" name="attendance_session_open_before_minutes" value={rules.attendance_session_open_before_minutes}/>
      <input type="hidden" name="attendance_session_close_after_minutes" value={rules.attendance_session_close_after_minutes}/>
    </>}
  </>;
}

function AttendanceFinalizationFields({ rules }: { rules: Rules }) {
  const [mode, setMode] = useState(rules.attendance_finalization_mode);
  return <>
    <label className="office-field">After submission
      <select name="attendance_finalization_mode" value={mode} onChange={(event) => setMode(event.target.value as Rules["attendance_finalization_mode"])}>
        <option value="automatic">Finalize automatically</option>
        <option value="principal_review">Require principal review</option>
      </select>
    </label>
    {mode === "automatic" ? <label className="office-field"><span>Finalization delay (minutes)</span>
      <input aria-label="Finalization delay (minutes)" name="attendance_auto_finalize_minutes" type="number" required min="0" max="1440" step="1" defaultValue={rules.attendance_auto_finalize_minutes}/>
      <small>Use 0 for the next automation pass, normally within a minute. The register can be corrected until it becomes final.</small>
    </label> : <input type="hidden" name="attendance_auto_finalize_minutes" value={rules.attendance_auto_finalize_minutes}/>}
  </>;
}
export function WorkflowRules({ schoolId, category, onDirtyChange = () => undefined }: { schoolId: string; category: keyof typeof fields; onDirtyChange?: (dirty: boolean) => void }) {
  const client = useQueryClient();
  const url = `/api/v1/operating-rules/${schoolId}`;
  const query = useQuery({ queryKey: ["workflow-rules", schoolId], queryFn: () => apiFetch<Rules>(url) });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (query.isPending) return <ScreenLoading/>;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch}/>;
  return <section className="office-panel"><h2>{category === "attendance" ? "Attendance" : "Operating windows"}</h2>
    <p className="office-hint">{copy[category]}</p>
    <form className="office-form" key={query.data.revision} onChange={() => onDirtyChange(true)} onSubmit={async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget);
      const { revision, ...values } = query.data;
      const updates: Record<string, unknown> = Object.fromEntries(fields[category].map(([key,,type]) => { const value = form.get(key); return [key, type === "time" ? value : Number(value)]; }));
      if (category === "attendance") {
        updates.attendance_academic_mode = form.get("attendance_academic_mode");
        updates.attendance_campus_mode = form.get("attendance_campus_mode");
        updates.attendance_academic_channels = form.getAll("attendance_academic_channels");
        updates.attendance_campus_channels = form.getAll("attendance_campus_channels");
        updates.attendance_self_check_in_mode = form.get("attendance_self_check_in_mode");
        updates.attendance_session_open_before_minutes = Number(form.get("attendance_session_open_before_minutes"));
        updates.attendance_session_close_after_minutes = Number(form.get("attendance_session_close_after_minutes"));
        updates.attendance_finalization_mode = form.get("attendance_finalization_mode");
        updates.attendance_auto_finalize_minutes = Number(form.get("attendance_auto_finalize_minutes"));
      }
      setBusy(true); setMessage("");
      try {
        await apiFetch<Rules>(url, { method: "POST", body: JSON.stringify({ ...values, ...updates, expected_revision: revision }) });
        await client.invalidateQueries(); onDirtyChange(false); setMessage("Operating rules saved.");
      } catch (error) { setMessage(error instanceof Error ? error.message : "Rules could not be saved."); }
      finally { setBusy(false); }
    }}>
      {category === "attendance" ? <AttendanceModelFields rules={query.data}/> : null}
      <div className="office-form-grid">{fields[category].map(([key,label,type,min,max]) => <label className="office-field" key={key}>{label}{type === "time" ? <TemporalInput name={key} type="time" required defaultValue={query.data[key]}/> : <input name={key} type="number" required step={1} min={min} max={max} defaultValue={query.data[key]}/>}</label>)}{category === "attendance" ? <AttendanceFinalizationFields rules={query.data}/> : null}</div>
      <p className="office-hint">New submissions snapshot these rules. Existing and historical registers keep the rule they already received.</p>
      <button className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save rules"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  </section>;
}
