import type { ReactNode, Ref } from "react";
import "./register-view.css";

/** One register presentation. Context adapters supply data and permitted actions. */
export function AttendanceRegisterView({ children }: { children: ReactNode }) {
  return <div className="attendance-register-view">{children}</div>;
}

export function AttendanceRegisterHeader({ title, context, state, action, headingRef }: {
  title: string;
  context: ReactNode;
  state: ReactNode;
  action?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return <header className="attendance-register-view__header">
    <div className="attendance-register-view__identity">
      <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
      <span className="attendance-register-view__state">{state}</span>
    </div>
    {action ? <div className="attendance-register-view__history">{action}</div> : null}
    <div className="attendance-register-view__context">{context}</div>
  </header>;
}

export function AttendanceRegisterProgress({ recorded, total, children }: {
  recorded: number;
  total: number;
  children?: ReactNode;
}) {
  return <div className="attendance-register-view__progress">
    <span aria-live="polite">{recorded} of {total} recorded</span>
    {children ? <div className="attendance-register-view__progress-actions">{children}</div> : null}
  </div>;
}

export function AttendanceRegisterTools({ children, id }: { children: ReactNode; id?: string }) {
  return <div className="attendance-register-view__tools" id={id}>{children}</div>;
}

export function AttendanceRegisterRoster({ children }: { children: ReactNode }) {
  return <div className="attendance-register-view__roster roll-call-roster">{children}</div>;
}

export function AttendanceRegisterFooter({ status, children }: { status: ReactNode; children: ReactNode }) {
  return <footer className="attendance-register-view__footer">
    <span className="attendance-register-view__save-state" role="status">{status}</span>
    <div className="attendance-register-view__footer-actions">{children}</div>
  </footer>;
}
