import React from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileSpreadsheet,
  GraduationCap,
  HelpCircle,
  LayoutDashboard,
  LockKeyhole,
  Mail,
  Menu,
  MessageCircle,
  MoreHorizontal,
  ShieldCheck,
  Sparkles,
  User,
  Users,
} from "lucide-react";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/plus-jakarta-sans/800.css";
import "./onboarding-story.css";
import { BrandLogo } from "../components/BrandLogo";

type Option = { icon: React.ReactNode; title: string; detail?: string; selected?: boolean };

const screen = Math.max(1, Math.min(10, Number(new URLSearchParams(location.search).get("screen") ?? 1)));

function Logo({ compact = false }: { compact?: boolean }) {
  return <BrandLogo className={compact ? "tc-logo tc-logo--compact" : "tc-logo"}/>;
}

function PrimaryButton({ children, disabled = false }: { children: React.ReactNode; disabled?: boolean }) {
  return <button className="primary-action" disabled={disabled}>{children}<ArrowRight size={17} strokeWidth={2.5} /></button>;
}

function PublicHeader() {
  return <header className="public-header"><Logo compact /><div className="public-header__actions"><span>School login</span><Menu size={22} /></div></header>;
}

function SetupHeader({ step, total, progress, back = true }: { step: number; total: number; progress: string; back?: boolean }) {
  return <header className="setup-header">
    <div className="setup-header__row"><Logo compact /><button className="help-button"><HelpCircle size={16} /> Help Center</button></div>
    <div className="stepper" aria-label={`${progress}, step ${step} of ${total}`}>{back ? <button className="stepper-back" aria-label="Back"><ArrowLeft size={18} /></button> : null}<span>{progress} · {step} of {total}</span><div>{Array.from({ length: total }, (_, index) => <i key={index} className={index < step ? "is-done" : ""} />)}</div></div>
  </header>;
}

function SetupPage({ step, total, progress, eyebrow, title, intro, children, action, back = true }: { step: number; total: number; progress: string; eyebrow?: string; title: string; intro?: string; children: React.ReactNode; action: string; back?: boolean }) {
  return <main className="screen setup-screen"><SetupHeader step={step} total={total} progress={progress} back={back} /><section className="setup-content">{eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}<h1>{title}</h1>{intro ? <p className="intro">{intro}</p> : null}{children}</section><footer className="setup-footer"><PrimaryButton>{action}</PrimaryButton></footer></main>;
}

function OptionList({ options }: { options: Option[] }) {
  return <div className="option-list">{options.map((option) => <button className={option.selected ? "option-row is-selected" : "option-row"} key={option.title}><span className="option-icon">{option.icon}</span><span className="option-copy"><strong>{option.title}</strong>{option.detail ? <small>{option.detail}</small> : null}</span>{option.selected ? <span className="selected-check"><Check size={15} strokeWidth={3} /></span> : <ChevronRight size={18} className="row-chevron" />}</button>)}</div>;
}

function Screen1() {
  return <main className="screen landing-screen"><PublicHeader /><section className="landing-copy"><span className="eyebrow">CAMPUS OPERATING SYSTEM</span><h1>Start with one job. Add the rest when you need it.</h1><p>Run attendance, entry and exit, examinations, or your whole campus—without setting everything up first.</p><PrimaryButton>Start free</PrimaryButton><button className="text-action">Explore the demo <ArrowRight size={16} /></button></section><section className="product-peek"><div className="product-peek__header"><span className="mini-crest">CIS</span><strong>Cambridge International School</strong><Bell size={20} /></div><div className="product-peek__title">Today</div><div className="peek-card"><span>REGISTER OPEN</span><strong>Class 6A attendance</strong><small>25 learners · Kavita Mehta</small><button>Take attendance <ArrowRight size={14} /></button></div></section><p className="landing-tagline">Not just any campus. That campus.</p></main>;
}

function Screen2() {
  return <SetupPage step={1} total={2} progress="Your account" eyebrow="GET STARTED" title="Create your ThatCampus account" intro="You’ll manage the workspace and can invite others later." action="Create account" back={false}><div className="form-card compact-form"><div className="two-field-row"><label>First name<div className="input-shell is-filled"><User size={18} /><span>Abhishek</span></div></label><label>Last name<div className="input-shell is-filled"><span>Yadav</span></div></label></div><label>Email address<div className="input-shell is-filled"><Mail size={18} /><span>you@school.org</span></div></label><label>Password<div className="input-shell is-filled"><LockKeyhole size={18} /><span>••••••••••••</span></div></label></div><p className="quiet-note"><ShieldCheck size={15} /> Your workspace stays private until you invite someone.</p></SetupPage>;
}

function Screen3() {
  return <SetupPage step={2} total={2} progress="Your account" eyebrow="ACCOUNT SECURITY" title="Protect your workspace" intro="Both checks are complete. You can continue safely." action="Continue"><div className="security-card"><div><span><CheckCircle2 size={20} /></span><p><strong>Email verified</strong><small>you@school.org</small></p><b>Done</b></div><div><span><ShieldCheck size={20} /></span><p><strong>Authenticator active</strong><small>Required for administrators</small></p><b>Done</b></div></div><div className="security-summary"><ShieldCheck size={19} /><span><strong>Protected</strong><small>2 of 2 security checks complete</small></span></div></SetupPage>;
}

function Screen4() {
  const options: Option[] = [
    { icon: <Building2 />, title: "School or college", detail: "ThatCampus reviews the institution before it opens" },
    { icon: <GraduationCap />, title: "Tutor or coaching workspace", detail: "Start now with a lightweight workspace", selected: true },
  ];
  return <SetupPage step={1} total={2} progress="Your workspace" eyebrow="WORKSPACE TYPE" title="What are you setting up?" intro="Choose the option that matches how you teach today." action="Continue with coaching"><OptionList options={options} /><p className="quiet-note"><ShieldCheck size={15} /> This workspace is not presented as a verified school or college.</p></SetupPage>;
}

function Screen5() {
  return <SetupPage step={2} total={2} progress="Your workspace" eyebrow="WORKSPACE DETAILS" title="Name your workspace" intro="You can change these details later." action="Create workspace"><div className="form-card compact-form"><label>Workspace name<div className="input-shell is-filled"><Building2 size={18} /><span>Bright Path Learning Centre</span></div></label><label>Teaching mode<div className="input-shell is-filled"><GraduationCap size={18} /><span>In person</span><ChevronDown size={17} /></div></label><label>Time zone<div className="input-shell is-filled"><Clock3 size={18} /><span>Asia/Kolkata</span><ChevronDown size={17} /></div></label><label className="check-row"><span className="fake-check"><Check size={13} /></span><span><strong>I teach learners under 18</strong><small>Keep age-appropriate safeguards enabled.</small></span></label></div><div className="info-strip"><ShieldCheck size={18} /><span><strong>You’ll be the administrator.</strong><small>You can assign other responsibilities later.</small></span></div></SetupPage>;
}

function ContextPill({ children }: { children: React.ReactNode }) {
  return <div className="context-pill"><Check size={14} strokeWidth={3} />{children}</div>;
}

function Screen6() {
  const options: Option[] = [
    { icon: <ClipboardCheck />, title: "Take attendance", detail: "One class or batch", selected: true },
    { icon: <Building2 />, title: "Record entry and exit", detail: "Students, staff and visitors" },
    { icon: <GraduationCap />, title: "Plan examinations", detail: "Schedule and coordinate an exam" },
  ];
  return <SetupPage step={1} total={4} progress="First outcome" eyebrow="START SMALL" title="What would you like to do first?" intro="We’ll only ask for what that needs." action="Set up attendance"><ContextPill>Workspace created</ContextPill><OptionList options={options} /><p className="quiet-note"><ShieldCheck size={15} /> Add another capability whenever you need it.</p></SetupPage>;
}

function Screen7() {
  return <SetupPage step={2} total={4} progress="Attendance setup" eyebrow="FIRST CLASS" title="Create your first class" intro="This is the group whose attendance you’ll take." action="Create Class 6A"><ContextPill>Attendance selected</ContextPill><div className="single-question-card"><span className="question-icon"><Users size={22} /></span><label>Class or batch name<div className="input-shell is-focused"><span>Class 6A</span></div></label><p>Examples: Class 6A, JEE Morning Batch, First Year B.Com</p><label className="check-row"><span className="fake-check"><Check size={13} /></span><span><strong>I teach this class</strong><small>Creates a class-scoped teaching assignment for you.</small></span></label></div></SetupPage>;
}

function Screen8() {
  return <SetupPage step={3} total={4} progress="Attendance setup" eyebrow="CLASS 6A" title="Add learners to Class 6A" intro="Upload a list or add people one by one." action="Add 25 learners"><ContextPill>Class 6A created · Taken by you</ContextPill><div className="choice-grid"><button className="choice-card is-selected"><FileSpreadsheet size={24} /><strong>Upload a list</strong><small>CSV or spreadsheet</small><span><Check size={13} /> 25 learners found</span></button><button className="choice-card"><User size={24} /><strong>Add manually</strong><small>One learner at a time</small></button></div><div className="import-preview"><header><strong>Ready to add</strong><span>25 learners</span></header><div><span>AS</span><p><strong>Aarav Sharma</strong><small>Student ID STU-1042</small></p><Check size={17} /></div><div><span>DP</span><p><strong>Diya Patel</strong><small>Student ID STU-1043</small></p><Check size={17} /></div><button>Review all 25 <ChevronRight size={16} /></button></div><p className="quiet-note"><ShieldCheck size={15} /> Nothing is sent to learners yet.</p></SetupPage>;
}

function Screen9() {
  return <SetupPage step={4} total={4} progress="Attendance setup" eyebrow="FIRST REGISTER" title="When should the register open?" intro="ThatCampus will prepare it for these class times." action="Create first register"><div className="schedule-card"><div className="day-pills">{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <button className={index < 5 ? "is-selected" : ""} key={`${day}-${index}`}>{day}</button>)}</div><div className="time-row"><label>Starts<strong>9:00 AM</strong></label><ArrowRight size={16} /><label>Ends<strong>9:45 AM</strong></label></div></div><div className="review-card"><header><span className="review-icon"><ClipboardCheck size={21} /></span><span><strong>Class 6A register</strong><small>25 learners · Monday–Friday</small></span></header><ul><li><span>Taken by</span><strong>You</strong><button>Change</button></li><li><span>Method</span><strong>Mark names manually</strong><button>Change</button></li></ul><button>Preview the register <ChevronRight size={16} /></button></div></SetupPage>;
}

function InstitutionHeader() {
  return <><header className="institution-header"><span className="crest">BP</span><strong>Bright Path<br />Learning Centre</strong><span className="header-spacer" /><button className="notification"><Bell size={20} /><i>1</i></button><span className="user-avatar">AY</span></header><div className="page-title"><h1>Today</h1></div></>;
}

function BottomNav() {
  return <nav className="bottom-nav"><button className="is-active"><LayoutDashboard /><span>Overview</span></button><button><BarChart3 /><span>Attendance</span></button><button><MessageCircle /><span>Assistant</span></button><button><Sparkles /><span>Insights</span></button><button><MoreHorizontal /><span>More</span></button></nav>;
}

function Screen10() {
  return <main className="screen app-screen"><InstitutionHeader /><section className="app-content"><div className="success-banner"><span><Check size={17} strokeWidth={3} /></span><div><strong>Attendance is ready</strong><small>Your first register is open.</small></div></div><div className="date-row"><strong>Mon, 19 October</strong><button>Timetable <ArrowRight size={16} /></button></div><section className="today-card"><span className="today-label">REGISTER OPEN · 9:00 AM</span><h2>Class 6A</h2><p>25 learners · Taken by you</p><div className="today-card__meta"><Clock3 size={15} /> 9:00 AM–9:45 AM</div><button>Take attendance <ArrowRight size={17} /></button></section><section className="app-list"><header><h2>Later</h2><span>Nothing else is required</span></header><div className="empty-ready"><CalendarDays size={21} /><span><strong>Your first operation is ready.</strong><small>Add another class or capability whenever you need it.</small></span></div></section></section><BottomNav /></main>;
}

const screens = [Screen1, Screen2, Screen3, Screen4, Screen5, Screen6, Screen7, Screen8, Screen9, Screen10];
const ActiveScreen = screens[screen - 1] ?? Screen1;

const root = createRoot(document.getElementById("root")!);
root.render(<ActiveScreen />);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
