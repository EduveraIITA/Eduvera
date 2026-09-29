import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toDataURL } from "qrcode";
import { BadgeCheck, X } from "lucide-react";
import "./student-pages.css";

export interface StudentIdentity {
  studentName: string;
  avatarUrl?: string;
  className: string;
  rollNumber: string;
  studentId: string;
  termLabel: string;
  dateLabel: string;
  attendancePercent: number;
  attendanceRecorded?: boolean;
  attendanceThreshold: number;
}

export function StudentIdentityCard({
  identity,
  schoolName = "Cambridge International School",
  switchChild,
  showSwitchButton = true,
  eyebrow = "Student identity",
  primaryHeading = true,
  modalInset = "student",
}: {
  identity: StudentIdentity;
  schoolName?: string;
  switchChild?: { name: string; onSelect: () => void; onSwipe?: (direction: "left" | "right") => void };
  showSwitchButton?: boolean;
  eyebrow?: string;
  primaryHeading?: boolean;
  modalInset?: "student" | "parent";
}) {
  const [idOpen, setIdOpen] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swiped = useRef(false);
  const initials = identity.studentName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const crest = schoolName.split(/\s+/).filter(Boolean).map((word) => word[0]).join("").slice(0, 3).toUpperCase();
  const attendanceRecorded = identity.attendanceRecorded !== false;
  const tone = !attendanceRecorded ? "" : identity.attendancePercent >= identity.attendanceThreshold
    ? "is-green"
    : identity.attendancePercent >= identity.attendanceThreshold - 10 ? "is-yellow" : "is-orange";
  const qrPayload = useMemo(() => JSON.stringify({
    version: 1,
    issuer: schoolName,
    type: "student_identity",
    studentId: identity.studentId,
    name: identity.studentName,
    class: identity.className,
    roll: identity.rollNumber,
    term: identity.termLabel,
  }), [schoolName, identity.studentId, identity.studentName, identity.className, identity.rollNumber, identity.termLabel]);

  useEffect(() => {
    if (!idOpen) return;
    let active = true;
    void toDataURL(qrPayload, {
      errorCorrectionLevel: "H", margin: 2, width: 360,
      color: { dark: "#103b86", light: "#ffffff" },
    }).then((url) => { if (active) setQrCodeUrl(url); });
    return () => { active = false; };
  }, [idOpen, qrPayload]);

  useEffect(() => {
    if (!idOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setIdOpen(false); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [idOpen]);

  return <>
    <section className="student-home-id-card" aria-label={`Open digital student ID for ${identity.studentName}${switchChild ? `. Swipe to switch to ${switchChild.name}` : ""}`} role="button" tabIndex={0}
      onClick={() => { if (swiped.current) { swiped.current = false; return; } setIdOpen(true); }}
      onKeyDown={(event) => { if (switchChild?.onSwipe && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); switchChild.onSwipe(event.key === "ArrowLeft" ? "left" : "right"); } else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setIdOpen(true); } }}
      onTouchStart={(event) => { touchStartX.current = event.touches[0]?.clientX ?? null; touchStartY.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={(event) => { if (switchChild && touchStartX.current !== null) { const touch = event.changedTouches[0]; const distance = (touch?.clientX ?? touchStartX.current) - touchStartX.current; const verticalDistance = (touch?.clientY ?? touchStartY.current ?? 0) - (touchStartY.current ?? 0); if (Math.abs(distance) > 55 && Math.abs(distance) > Math.abs(verticalDistance) * 1.2) { swiped.current = true; if (switchChild.onSwipe) switchChild.onSwipe(distance > 0 ? "right" : "left"); else switchChild.onSelect(); window.setTimeout(() => { swiped.current = false; }, 250); } } touchStartX.current = null; touchStartY.current = null; }}
      onTouchCancel={() => { touchStartX.current = null; touchStartY.current = null; }}>
      <header><span>{identity.dateLabel}</span><span><BadgeCheck size={14} /> Active student</span></header>
      <div className="student-home-id-card__identity">
        <span className="student-home-avatar" aria-hidden="true">{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : initials}</span>
        <span className="student-home-id-card__copy"><small>{eyebrow}</small>{primaryHeading ? <h1 id="student-home-heading">{identity.studentName}</h1> : <strong className="student-home-id-card__name">{identity.studentName}</strong>}<p>{identity.className} - Roll {identity.rollNumber}</p></span>
        <span className={`student-home-attendance-score ${tone}`} aria-label={attendanceRecorded ? `Attendance ${Math.round(identity.attendancePercent)} percent` : "Attendance not recorded"}><strong>{attendanceRecorded ? `${Math.round(identity.attendancePercent)}%` : "—"}</strong><small>Attendance</small></span>
      </div>
      <footer>
        <span><small>Student ID</small><strong>{identity.studentId}</strong></span>
        <span><small>Academic term</small><strong>{identity.termLabel}</strong></span>
        <i aria-hidden="true" />
      </footer>
    </section>
    {switchChild && showSwitchButton ? <button className="parent-id-switch" type="button" onClick={switchChild.onSelect}>Switch to {switchChild.name}</button> : null}
    {idOpen ? createPortal(<div className={`student-id-view${modalInset === "parent" ? " student-id-view--parent" : ""}`} role="dialog" aria-modal="true" aria-labelledby="digital-student-id-heading">
      <button className="student-id-view__close" type="button" onClick={() => setIdOpen(false)} aria-label="Close digital student ID"><X size={20} /></button>
      <section className="student-id-view__card">
        <header><span className="student-id-view__crest">{crest}</span><span><strong>{schoolName}</strong><small>Digital Student Identity</small></span><BadgeCheck size={22} /></header>
        <div className="student-id-view__identity"><span>{identity.avatarUrl ? <img src={identity.avatarUrl} alt="" /> : initials}</span><div><small>Student name</small><h2 id="digital-student-id-heading">{identity.studentName}</h2><p>{identity.className} - Roll {identity.rollNumber}</p></div></div>
        <div className="student-id-view__details"><span><small>Admission number</small><strong>{identity.studentId}</strong></span><span><small>Academic term</small><strong>{identity.termLabel}</strong></span></div>
        <div className="student-id-view__qr">
          {qrCodeUrl ? <img src={qrCodeUrl} alt={`QR code for ${identity.studentName}, student ID ${identity.studentId}`} /> : <span aria-label="Generating identity QR code" />}
          <span><small>Scan to verify school identity</small><strong>{identity.studentId}</strong></span>
        </div>
      </section>
      <p>Show this screen when your school asks for student identification.</p>
    </div>, document.body) : null}
  </>;
}
