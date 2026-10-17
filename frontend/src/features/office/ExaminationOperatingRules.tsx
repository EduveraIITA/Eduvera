import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { apiFetch } from "../../lib/api";
import { LiveRouteError, ScreenLoading } from "../school/LiveRouteState";

type ExaminationRules = {
  readiness_minutes_before: number;
  attendance_close_after_minutes: number;
  minimum_invigilators: number;
  require_all_candidate_attendance: boolean;
  post_completion_marking_mode: "manual" | "automatic";
  revision: number;
};

export function ExaminationOperatingRules({
  schoolId,
  onDirtyChange,
}: {
  schoolId: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const client = useQueryClient();
  const url = `/api/v1/schools/${encodeURIComponent(schoolId)}/assessments/exam-policy/`;
  const query = useQuery({
    queryKey: ["operating-rules", schoolId, "examinations"],
    queryFn: () => apiFetch<ExaminationRules>(url),
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (query.isPending) return <ScreenLoading />;
  if (query.isError) return <LiveRouteError error={query.error} onRetry={query.refetch} />;
  const rules = query.data;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      await apiFetch<ExaminationRules>(url, {
        method: "POST",
        body: JSON.stringify({
          expected_revision: rules.revision,
          readiness_minutes_before: Number(form.get("readiness_minutes_before")),
          attendance_close_after_minutes: Number(form.get("attendance_close_after_minutes")),
          minimum_invigilators: Number(form.get("minimum_invigilators")),
          require_all_candidate_attendance: form.has("require_all_candidate_attendance"),
          post_completion_marking_mode: form.get("post_completion_marking_mode"),
        }),
      });
      onDirtyChange(false);
      await query.refetch();
      await client.invalidateQueries();
      setMessage("Examination rules saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Examination rules could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="office-panel operating-category">
    <h2>Examination day</h2>
    <p className="office-hint">Set the institution-wide preparation and closing behaviour for physical examinations. Each sitting keeps the rule version it received.</p>
    <form className="office-form" key={rules.revision} onChange={() => onDirtyChange(true)} onSubmit={(event) => void submit(event)}>
      <div className="office-form-grid">
        <label className="office-field">Begin readiness checks before start (minutes)
          <input name="readiness_minutes_before" type="number" required min="0" max="10080" defaultValue={rules.readiness_minutes_before}/>
          <small>Rooms, candidate capacity and invigilation are checked from this point.</small>
        </label>
        <label className="office-field">Keep attendance open after end (minutes)
          <input name="attendance_close_after_minutes" type="number" required min="0" max="10080" defaultValue={rules.attendance_close_after_minutes}/>
        </label>
        <label className="office-field">Minimum invigilators per sitting
          <input name="minimum_invigilators" type="number" required min="1" max="20" defaultValue={rules.minimum_invigilators}/>
        </label>
        <label className="office-field">After the sitting is completed
          <select aria-label="After the sitting is completed" name="post_completion_marking_mode" defaultValue={rules.post_completion_marking_mode}>
            <option value="manual">Exam in-charge opens marking</option>
            <option value="automatic">Open marking automatically</option>
          </select>
          <small>Moderation and publication always remain explicit decisions.</small>
        </label>
      </div>
      <label className="departure-check"><input name="require_all_candidate_attendance" type="checkbox" defaultChecked={rules.require_all_candidate_attendance}/> Require every candidate to be recorded before completing the sitting</label>
      <p className="office-hint">Attendance observations stay separate from marks and published result outcomes.</p>
      <button className="office-primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
      {message ? <p role="status" className="office-hint">{message}</p> : null}
    </form>
  </section>;
}
