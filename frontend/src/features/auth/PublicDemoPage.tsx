import { useState } from "react";
import { ArrowRight, GraduationCap, LoaderCircle, School, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authDestination, useAuth } from "./AuthContext";
import "./public-demo.css";

const profiles = [
  { role: "admin" as const, name: "Meera Kapoor", label: "Principal", detail: "See school operations, attendance and insights.", icon: School },
  { role: "staff" as const, name: "Kavita Mehta", label: "Teacher", detail: "Explore classes, registers and the teaching day.", icon: UserRound },
  { role: "parent" as const, name: "Pooja Sharma", label: "Parent", detail: "Follow attendance, requests and family updates.", icon: UsersRound },
  { role: "student" as const, name: "Aarav Sharma", label: "Student", detail: "Open the learner view for schedules and schoolwork.", icon: GraduationCap },
];

const profileDestinations = {
  admin: "/principal",
  staff: "/teacher",
  parent: "/parent/home",
  student: "/student",
} as const;

export default function PublicDemoPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (auth.status === "authenticated") return <Navigate to={authDestination(auth)} replace />;

  async function open(role: (typeof profiles)[number]["role"]) {
    setPending(role); setError(null);
    try { await auth.enterPublicDemo(role); void navigate(profileDestinations[role], { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The demo could not be opened."); setPending(null); }
  }

  return <main className="public-demo-page">
    <header className="public-demo-header"><Link to="/login">ThatCampus</Link><span><ShieldCheck size={16}/> Sample data · read-only</span></header>
    <section className="public-demo-intro"><span>Explore without signing up</span><h1>Choose a view.<br/>Step into the school day.</h1><p>This is the real ThatCampus application with synthetic school data. Nothing you do here can change a school record.</p></section>
    {error ? <p className="public-demo-error" role="alert">{error}</p> : null}
    <section className="public-demo-grid" aria-label="Demo profiles">{profiles.map(profile => {
      const Icon = profile.icon;
      return <button key={profile.role} type="button" onClick={() => void open(profile.role)} disabled={pending !== null}>
        <span className={`public-demo-icon public-demo-icon--${profile.role}`}><Icon size={24}/></span>
        <span className="public-demo-copy"><small>{profile.label}</small><strong>{profile.name}</strong><em>{profile.detail}</em></span>
        {pending === profile.role ? <LoaderCircle className="auth-spin" size={20}/> : <ArrowRight size={20}/>}
      </button>;
    })}</section>
    <footer><ShieldCheck size={15}/><span>Sessions expire automatically. AI, uploads and record changes are disabled in this public preview.</span><Link to="/login">School login</Link></footer>
  </main>;
}
