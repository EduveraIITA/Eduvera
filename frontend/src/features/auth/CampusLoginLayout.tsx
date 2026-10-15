import Threads from "./Threads";
import type { ReactNode } from "react";
import { BookOpenCheck, ShieldCheck, UsersRound, CalendarDays } from "lucide-react";
import "./campus-login.css";

export function CampusLoginLayout({ children }: { children: ReactNode }) {
  return <div className="campus-login">
    <div className="campus-login__frame">
      <header className="campus-login__topbar">
        <a className="campus-login__brand" href="/" aria-label="ThatCampus portal">
          <img className="campus-login__brand-logo" src="/assets/thatcampus-logo.png" alt="ThatCampus" width="104" height="62" />
          <span><small>PORTAL ACCESS</small></span>
        </a>
        <div className="campus-login__top-actions">
          <span className="campus-login__access"><ShieldCheck size={13} aria-hidden="true" />School portal</span>
          <details className="campus-login__help">
            <summary>Help Center</summary>
            <div><strong>Need help signing in?</strong><p>Use the email or username linked to your school account. Contact your school office for an invitation or access.</p><a href="/forgot-password">Reset your password</a></div>
          </details>
        </div>
      </header>
      <main className="campus-login__stage">
        <Threads />
        <div className="campus-login__badge campus-login__badge--one"><CalendarDays size={17} aria-hidden="true" /><span>Attendance &amp; timetables</span></div>
        <div className="campus-login__badge campus-login__badge--two"><ShieldCheck size={17} aria-hidden="true" /><span>Role-based access</span></div>
        <div className="campus-login__badge campus-login__badge--three"><BookOpenCheck size={20} aria-hidden="true" /><span>Campus workspace<small>Your school day, connected</small></span></div>
        <div className="campus-login__badge campus-login__badge--four"><UsersRound size={20} aria-hidden="true" /><span>School community<small>Staff, students &amp; families</small></span></div>
        <div className="campus-login__center">
          <section className="campus-login__card" aria-labelledby="campus-login-title">
            <header className="campus-login__heading">
              <img className="campus-login__main-logo" src="/assets/thatcampus-logo.png" alt="ThatCampus" width="152" height="90" />
              <h1 id="campus-login-title">Welcome back</h1>
              <p>Access your attendance, timetable, and campus portal</p>
            </header>
            {children}
          </section>
          <p className="campus-login__assurance"><ShieldCheck size={14} aria-hidden="true" />Your school. Your secure workspace.</p>
        </div>
      </main>
      <footer className="campus-login__footer"><span>© {new Date().getFullYear()} ThatCampus. All rights reserved.</span><nav aria-label="Portal support"><a href="/join">Join institution</a><a href="/forgot-password">Account help</a></nav></footer>
    </div>
  </div>;
}
