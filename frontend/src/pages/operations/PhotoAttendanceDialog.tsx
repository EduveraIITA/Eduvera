import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Camera,
  Check,
  ImageOff,
  ImagePlus,
  LoaderCircle,
  ScanSearch,
  ScanFace,
  ShieldCheck,
  UserRoundCheck,
  X,
} from "lucide-react";
import type { AttendanceStatus, TeacherAttendanceRecordInput } from "../../features/operations/api";
import {
  analyzeAttendancePhoto,
  enrollPhotoAttendanceSample,
  getPhotoAttendanceSetup,
  type PhotoAttendanceAnalysis,
  type PhotoAttendanceSetup,
} from "../../features/operations/photoAttendanceApi";
import "./photo-attendance.css";

const statusLabels: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  late: "Late",
  excused: "Excused",
  half_day: "Half day",
};

type Mode = "capture" | "references";

export function PhotoAttendanceDialog({
  classSectionId,
  date,
  portal,
  onClose,
  onApply,
}: {
  classSectionId: string;
  date: string;
  portal: "teacher" | "principal";
  onClose: () => void;
  onApply: (records: TeacherAttendanceRecordInput[], sessionId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const sampleCameraRef = useRef<HTMLInputElement>(null);
  const sampleUploadRef = useRef<HTMLInputElement>(null);
  const sampleSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiPreferenceInitializedRef = useRef(false);
  const [mode, setMode] = useState<Mode>("capture");
  const [setup, setSetup] = useState<PhotoAttendanceSetup | null>(null);
  const [setupState, setSetupState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [period, setPeriod] = useState("Daily attendance");
  const [captureReference, setCaptureReference] = useState("");
  const [captureConfirmed, setCaptureConfirmed] = useState(false);
  const [analysis, setAnalysis] = useState<PhotoAttendanceAnalysis | null>(null);
  const [analysisState, setAnalysisState] = useState<"idle" | "analyzing" | "ready">("idle");
  const [review, setReview] = useState<Record<string, AttendanceStatus | null>>({});
  const [authorizationReference, setAuthorizationReference] = useState("");
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [enrollStudentId, setEnrollStudentId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<string | null>(null);
  const [enrollingSource, setEnrollingSource] = useState<"camera" | "upload" | null>(null);
  const [sampleAddedStudentId, setSampleAddedStudentId] = useState<string | null>(null);
  const [useLocalAi, setUseLocalAi] = useState(false);

  const loadSetup = useCallback(async () => {
    setSetupState("loading");
    setError("");
    try {
      const nextSetup = await getPhotoAttendanceSetup(classSectionId, date);
      setSetup(nextSetup);
      if (!aiPreferenceInitializedRef.current) {
        setUseLocalAi(nextSetup.ai_assist.available);
        aiPreferenceInitializedRef.current = true;
      }
      setSetupState("ready");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Photo attendance could not load.");
      setSetupState("error");
    }
  }, [classSectionId, date]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    void loadSetup();
    return () => dialog.removeEventListener("cancel", cancel);
  }, [loadSetup, onClose]);

  useEffect(() => () => {
    if (sampleSuccessTimerRef.current) clearTimeout(sampleSuccessTimerRef.current);
  }, []);

  const preview = useMemo(() => photo ? URL.createObjectURL(photo) : "", [photo]);
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    setPhoto(file);
    setAnalysis(null);
    setAnalysisState("idle");
    setError("");
  };

  const analyze = async () => {
    if (!photo || !setup?.available || !setup.attendance.can_mark || captureReference.trim().length < 3 || !captureConfirmed) return;
    setAnalysisState("analyzing");
    setError("");
    try {
      const result = await analyzeAttendancePhoto({
        classSectionId,
        date,
        period: period.trim(),
        authorizationReference: captureReference.trim(),
        file: photo,
        useLocalAi,
      });
      setAnalysis(result);
      setReview(Object.fromEntries(result.students.map((student) => [
        student.student_id,
        student.current_status ?? (student.proposal === "present" ? "present" : null),
      ])));
      setAnalysisState("ready");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The classroom photo could not be analyzed.");
      setAnalysisState("idle");
    }
  };

  const beginEnrollment = (studentId: string, source: "camera" | "upload") => {
    setEnrollStudentId(studentId);
    setEnrollingSource(source);
    if (source === "camera") sampleCameraRef.current?.click();
    else sampleUploadRef.current?.click();
  };

  const enroll = async (file: File | undefined) => {
    if (!file || !enrollStudentId || authorizationReference.trim().length < 3 || !authorizationConfirmed) return;
    const studentId = enrollStudentId;
    setEnrolling(studentId);
    setError("");
    try {
      await enrollPhotoAttendanceSample({
        classSectionId,
        studentId,
        date,
        authorizationReference: authorizationReference.trim(),
        file,
      });
      await loadSetup();
      setSampleAddedStudentId(studentId);
      if (sampleSuccessTimerRef.current) clearTimeout(sampleSuccessTimerRef.current);
      sampleSuccessTimerRef.current = setTimeout(() => setSampleAddedStudentId(null), 2200);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The reference photo could not be enrolled.");
    } finally {
      setEnrolling(null);
      setEnrollingSource(null);
      setEnrollStudentId(null);
      if (sampleCameraRef.current) sampleCameraRef.current.value = "";
      if (sampleUploadRef.current) sampleUploadRef.current.value = "";
    }
  };

  const reviewedCount = Object.values(review).filter(Boolean).length;
  const allReviewed = Boolean(analysis && reviewedCount === analysis.students.length);
  const apply = () => {
    if (!analysis || !allReviewed) return;
    onApply(analysis.students.map((student) => ({
      student_id: student.student_id,
      status: review[student.student_id]!,
      remarks: "",
    })), analysis.id);
    onClose();
  };
  const matchedNames = useMemo(() => new Map(analysis?.students.map((student) => [student.face_id, student.name]) ?? []), [analysis]);

  return (
    <dialog className="photo-attendance-dialog" ref={dialogRef} aria-labelledby="photo-attendance-title">
      <div className="photo-attendance-sheet">
        <div className="photo-attendance-handle" aria-hidden="true" />
        <header className="photo-attendance-header">
          <span className="photo-attendance-header__icon"><ScanFace size={22} /></span>
          <div>
            <span>Attendance assistant</span>
            <h2 id="photo-attendance-title">Photo roll call</h2>
          </div>
          <button type="button" aria-label="Close photo attendance" onClick={onClose}><X size={20} /></button>
        </header>

        {portal === "principal" && !analysis ? (
          <div className="photo-attendance-tabs" role="tablist" aria-label="Photo attendance sections">
            <button type="button" role="tab" aria-selected={mode === "capture"} onClick={() => setMode("capture")}>Take attendance</button>
            <button type="button" role="tab" aria-selected={mode === "references"} onClick={() => setMode("references")}>Reference setup</button>
          </div>
        ) : null}

        {setupState === "loading" ? (
          <div className="photo-attendance-loading" role="status"><LoaderCircle className="spin" size={24} />Checking photo setup…</div>
        ) : null}
        {error ? <div className="photo-attendance-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        {setupState === "error" ? <button className="photo-attendance-secondary" type="button" onClick={() => void loadSetup()}>Try again</button> : null}

        {setupState === "ready" && setup && mode === "capture" && !analysis ? (
          <div className="photo-attendance-content">
            <section className="photo-attendance-readiness" aria-label="Photo attendance readiness">
              <div><strong>{setup.enrolled_count}/{setup.students.length}</strong><span>students with references</span></div>
              <span className={setup.available && setup.attendance.can_mark ? "is-ready" : "is-unavailable"}>{!setup.attendance.can_mark ? "No register due" : setup.available ? "Local engine ready" : "Manual register available"}</span>
            </section>
            {!setup.attendance.can_mark ? (
              <section className="photo-attendance-boundary">
                <CalendarDays size={19} />
                <div><strong>Photo attendance is not available</strong><p>{setup.attendance.reason}</p></div>
              </section>
            ) : !setup.available ? (
              <section className="photo-attendance-boundary">
                <AlertTriangle size={19} />
                <div><strong>Photo suggestions are unavailable</strong><p>{setup.unavailable_reason}</p></div>
              </section>
            ) : setup.enrolled_count === 0 ? (
              <section className="photo-attendance-boundary">
                <ShieldCheck size={19} />
                <div><strong>Reference setup is required</strong><p>A principal must record authorization and enroll individual reference photos. Continue with the manual register today.</p></div>
              </section>
            ) : null}

            <section className={`photo-capture-card${preview ? " has-preview" : ""}`}>
              {preview ? <img src={preview} alt="Selected classroom preview" /> : <Camera size={34} aria-hidden="true" />}
              <div>
                <strong>{photo ? photo.name : "Add one classroom photo"}</strong>
                <p>Use a clear, original image. Faces that cannot be matched stay for teacher review.</p>
              </div>
              <div className="photo-capture-actions">
                <button type="button" onClick={() => cameraRef.current?.click()}><Camera size={17} />Take photo</button>
                <button type="button" onClick={() => uploadRef.current?.click()}><ImagePlus size={17} />Choose photo</button>
              </div>
              <input ref={cameraRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" onChange={(event) => choosePhoto(event.target.files?.[0])} />
              <input ref={uploadRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={(event) => choosePhoto(event.target.files?.[0])} />
            </section>

            <div className="photo-attendance-fields">
              <label>Register period<input value={period} maxLength={100} onChange={(event) => setPeriod(event.target.value)} /></label>
              <label>Capture authority reference<input value={captureReference} minLength={3} maxLength={500} placeholder="School-approved record or policy reference" onChange={(event) => setCaptureReference(event.target.value)} /></label>
              <label className="photo-attendance-check"><input type="checkbox" checked={captureConfirmed} onChange={(event) => setCaptureConfirmed(event.target.checked)} /><span>I confirm this capture is authorized for this class. A photo does not prove liveness or absence.</span></label>
            </div>

            {setup.ai_assist.preview_enabled && <label className={`photo-ai-assist${setup.ai_assist.available ? "" : " is-unavailable"}`} aria-disabled={!setup.ai_assist.available}>
              <input type="checkbox" checked={useLocalAi && setup.ai_assist.available} disabled={!setup.ai_assist.available} onChange={(event) => setUseLocalAi(event.target.checked)} />
              <span className="photo-ai-assist__icon"><ScanSearch size={19} /></span>
              <span>
                <strong>Local AI cross-check</strong>
                <small>{setup.ai_assist.available
                  ? `${setup.ai_assist.model ?? "Local vision model"} compares detected faces with enrolled references after normal face matching.`
                  : setup.ai_assist.unavailable_reason ?? "Local AI cross-check is unavailable."}</small>
              </span>
            </label>}

            <button className="photo-attendance-primary" type="button" disabled={!photo || !setup.available || !setup.attendance.can_mark || setup.enrolled_count === 0 || period.trim().length === 0 || captureReference.trim().length < 3 || !captureConfirmed || analysisState === "analyzing"} onClick={() => void analyze()}>
              {analysisState === "analyzing" ? <><LoaderCircle className="spin" size={18} />Analyzing on this Mac…</> : <><ScanFace size={18} />Analyze classroom photo</>}
            </button>
            <p className="photo-attendance-fineprint">Only strong matches can suggest Present. Unmatched, missing and low-quality faces remain unmarked.</p>
          </div>
        ) : null}

        {setupState === "ready" && setup && mode === "references" && !analysis ? (
          <div className="photo-attendance-content">
            <section className="photo-attendance-boundary">
              <ShieldCheck size={19} />
              <div><strong>Principal-managed biometric setup</strong><p>Use clear individual photos and a documented authorization reference. The manual register remains the non-biometric alternative.</p></div>
            </section>
            <div className="photo-attendance-fields">
              <label>Authorization reference<input value={authorizationReference} minLength={3} maxLength={500} placeholder="Approved consent or school policy record" onChange={(event) => setAuthorizationReference(event.target.value)} /></label>
              <label className="photo-attendance-check"><input type="checkbox" checked={authorizationConfirmed} onChange={(event) => setAuthorizationConfirmed(event.target.checked)} /><span>I am authorized to enroll these reference photos for this purpose.</span></label>
            </div>
            <div className="photo-reference-list" aria-label="Student reference coverage">
              {setup.students.map((student) => (
                <article key={student.student_id} className={sampleAddedStudentId === student.student_id ? "is-added" : ""}>
                  <StudentAvatar name={student.name} url={student.avatar_url} />
                  <div><strong>{student.name}</strong><span>Roll {student.roll_number} · {student.sample_count} {student.sample_count === 1 ? "sample" : "samples"}</span></div>
                  <div className="photo-reference-actions">
                    <button type="button" disabled={!setup.available || !authorizationConfirmed || authorizationReference.trim().length < 3 || Boolean(enrolling)} onClick={() => beginEnrollment(student.student_id, "camera")}>
                      {enrolling === student.student_id && enrollingSource === "camera" ? <LoaderCircle className="spin" size={16} /> : <Camera size={16} />}
                      Camera
                    </button>
                    <button type="button" disabled={!setup.available || !authorizationConfirmed || authorizationReference.trim().length < 3 || Boolean(enrolling)} onClick={() => beginEnrollment(student.student_id, "upload")}>
                      {enrolling === student.student_id && enrollingSource === "upload" ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
                      Upload
                    </button>
                    {sampleAddedStudentId === student.student_id ? <span className="photo-reference-success" role="status"><Check size={15} />Added</span> : null}
                  </div>
                </article>
              ))}
            </div>
            <input ref={sampleCameraRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="user" onChange={(event) => void enroll(event.target.files?.[0])} />
            <input ref={sampleUploadRef} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={(event) => void enroll(event.target.files?.[0])} />
          </div>
        ) : null}

        {analysis ? (
          <div className="photo-attendance-content photo-review">
            <section className="photo-review-summary" aria-label="Photo analysis summary">
              <div><strong>{analysis.summary.detected_faces}</strong><span>faces detected</span></div>
              <div><strong>{analysis.summary.proposed_present}</strong><span>present suggestions</span></div>
              <div><strong>{analysis.summary.needs_review}</strong><span>need review</span></div>
            </section>
            <section className="photo-attendance-boundary is-calm">
              <UserRoundCheck size={19} />
              <div><strong>{analysis.analysis_mode === "local_llm" ? "Local AI cross-check complete" : "Suggestions are ready"}</strong><p>Check every row. “Not seen” remains blank until you make the attendance decision.</p></div>
            </section>
            {analysis.faces.length ? (
              <section className="photo-face-strip" aria-label="Detected face evidence">
                {analysis.faces.map((face) => (
                  <article key={face.face_id} className={`is-${face.state}`}>
                    <FaceEvidenceThumbnail source={face.thumbnail} faceId={face.face_id} />
                    <span>{matchedNames.get(face.face_id) ?? (face.state === "review" ? "Review match" : "Unmatched")}</span>
                    <small>{face.state === "auto" ? "Suggested" : "Teacher review"}</small>
                  </article>
                ))}
              </section>
            ) : null}
            <section className="photo-review-roster" aria-label="Review photo attendance suggestions">
              <header><h3>Review class</h3><span>{reviewedCount}/{analysis.students.length} marked</span></header>
              {analysis.students.map((student) => (
                <article key={student.student_id}>
                  <StudentAvatar name={student.name} url={student.avatar_url} />
                  <div>
                    <strong>{student.name}</strong>
                    <span>Roll {student.roll_number}</span>
                    {student.proposal === "present" ? <small><Check size={13} />Matched in photo</small> : <small className="needs-review">Not matched · decide manually</small>}
                  </div>
                  <label>
                    <span className="sr-only">Attendance status for {student.name}</span>
                    <select value={review[student.student_id] ?? ""} onChange={(event) => setReview((current) => ({ ...current, [student.student_id]: event.target.value ? event.target.value as AttendanceStatus : null }))}>
                      <option value="">Not marked</option>
                      {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </label>
                </article>
              ))}
            </section>
            <button className="photo-attendance-primary" type="button" disabled={!allReviewed} onClick={apply}><Check size={18} />Use reviewed marks in register</button>
            {!allReviewed ? <p className="photo-attendance-fineprint">Mark the remaining {analysis.students.length - reviewedCount} students before returning to the register.</p> : <p className="photo-attendance-fineprint">These marks stay unsaved until you submit the class register.</p>}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

function StudentAvatar({ name, url }: { name: string; url: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="photo-student-avatar" aria-hidden="true">
      {url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}
    </span>
  );
}

function FaceEvidenceThumbnail({ source, faceId }: { source: string; faceId: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="photo-face-fallback" role="img" aria-label={`Preview unavailable for detected face ${faceId}`}>
      <ImageOff size={22} />
    </span>
  ) : (
    <img src={source} alt={`Detected face ${faceId}`} onError={() => setFailed(true)} />
  );
}
