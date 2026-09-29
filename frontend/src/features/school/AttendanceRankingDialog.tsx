import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import "./attendance-ranking.css";

export interface AttendanceRank {
  rank: number | null;
  name: string;
  avatarUrl?: string | null;
  attended: number;
  held: number;
  streak?: number;
  percent: number | null;
  current: boolean;
}

export interface AttendanceRankingData {
  students: AttendanceRank[];
  cohortSize: number;
  asOf?: string;
}

function Portrait({ student }: { student: AttendanceRank }) {
  const [failed, setFailed] = useState(false);
  const initials = student.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <span className="attendance-ranking__portrait">
    {student.avatarUrl && !failed ? <img src={student.avatarUrl} alt="" onError={() => setFailed(true)} /> : initials}
  </span>;
}

export function AttendanceRankingDialog({ ranking, className, onClose, focusIndex, currentLabel = "You" }: {
  ranking?: AttendanceRankingData;
  className: string;
  onClose: () => void;
  focusIndex?: number;
  currentLabel?: "You" | "Your child";
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    if (focusIndex !== undefined) {
      listRef.current?.querySelectorAll<HTMLElement>(".attendance-ranking__row")[focusIndex]?.scrollIntoView?.({ block: "center" });
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        // The close control is the only tabbable item in this read-only dialog.
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [focusIndex, onClose]);

  return createPortal(
    <div className="attendance-ranking__overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="attendance-ranking" role="dialog" aria-modal="true" aria-labelledby="attendance-ranking-title" aria-describedby="attendance-ranking-description">
        <header className="attendance-ranking__header">
          <div>
            <span className="attendance-ranking__eyebrow">Class attendance</span>
            <h2 id="attendance-ranking-title">{className} standings</h2>
            <p id="attendance-ranking-description">{ranking?.asOf ? `Updated ${ranking.asOf}. ` : ""}{ranking?.cohortSize ?? 0} eligible students</p>
          </div>
          <button ref={closeRef} type="button" className="attendance-ranking__close" aria-label="Close attendance standings" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="attendance-ranking__list" ref={listRef} role="list" aria-label="All class attendance">
          {ranking?.students.length ? ranking.students.map((student, index) => (
            <div role="listitem" key={index} className={`attendance-ranking__row${student.current ? " attendance-ranking__row--current" : ""}`} aria-label={`${student.current ? `${currentLabel}, ` : ""}${student.name}, ${student.rank === null ? "not ranked" : `rank ${student.rank}`}, ${student.percent === null ? "no recorded attendance" : `${student.percent.toFixed(1)}% attendance`}`}>
              <span className="attendance-ranking__position">{student.rank === null ? "N/A" : `#${student.rank}`}</span>
              <Portrait student={student} />
              <span className="attendance-ranking__identity"><strong>{student.name}{student.current ? <em>{currentLabel}</em> : null}</strong><small>{student.held ? `${student.attended}/${student.held} days` : "No recorded days"}{student.streak ? ` · ${student.streak}d streak` : ""}</small></span>
              <strong className="attendance-ranking__percent">{student.percent === null ? "N/A" : `${student.percent.toFixed(1)}%`}</strong>
            </div>
          )) : <p className="attendance-ranking__empty">Class standings will appear once attendance has been recorded and published.</p>}
        </div>
        <footer>Classmates' surnames are abbreviated. A rank requires at least five recorded school days.</footer>
      </section>
    </div>, document.body,
  );
}
