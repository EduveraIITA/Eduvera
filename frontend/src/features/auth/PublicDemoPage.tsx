import { ThatCampusLoadingIcon as LoaderCircle } from "../../components/ThatCampusLoader";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, GraduationCap, School, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { apiFetch } from "../../lib/api";
import "./public-demo.css";

const profiles = [
  { role: "admin" as const, name: "Meera Kapoor", label: "Principal", detail: "See school operations, attendance and insights.", icon: School },
  { role: "staff" as const, name: "Kavita Mehta", label: "Teacher", detail: "Explore classes, registers and the teaching day.", icon: UserRound },
  { role: "parent" as const, name: "Pooja Sharma", label: "Parent", detail: "Follow attendance, requests and family updates.", icon: UsersRound },
  { role: "student" as const, name: "Aarav Sharma", label: "Student", detail: "Open the learner view for schedules and schoolwork.", icon: GraduationCap },
];

const profileDestinations = {
  admin: "/today",
  staff: "/today",
  parent: "/today",
  student: "/today",
} as const;

export default function PublicDemoPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leavingAccount, setLeavingAccount] = useState(false);
  const availability = useQuery({
    queryKey: ["auth", "public-demo-config"],
    queryFn: () => apiFetch<{ enabled: boolean }>("/api/v1/auth/public-demo-config/"),
    staleTime: 0,
    retry: false,
  });

  if (auth.status === "loading" || availability.isPending) return <main className="public-demo-page"><p role="status">Checking the sample campus…</p></main>;
  if (availability.isError || availability.data?.enabled !== true) return <main className="public-demo-page">
    <header className="public-demo-header"><Link to="/login">ThatCampus</Link></header>
    <section className="public-demo-warning">
      <span>Sample campus</span><h1>{availability.isError ? "We couldn’t check the sample campus." : "The sample campus isn’t available here."}</h1>
      <p>{availability.isError ? "Check the connection and try again, or continue with your own account." : "You can create your own campus account or sign in to an existing workspace."}</p>
      {availability.isError ? <button type="button" onClick={() => void availability.refetch()}>Try again</button> : null}
      <div>{auth.status === "authenticated" ? <Link to="/today">Return to my workspace</Link> : <><Link to="/signup">Create an account</Link><Link to="/login">Sign in</Link></>}</div>
    </section>
  </main>;
  if (auth.status === "authenticated" && !auth.publicDemo) return <main className="public-demo-page">
    <header className="public-demo-header"><Link to="/">ThatCampus</Link><span><ShieldCheck size={16}/> Your workspace is safe</span></header>
    <section className="public-demo-warning">
      <span>Sample campus</span><h1>Explore without changing your workspace.</h1>
      <p>Your work is saved. To keep the sample campus isolated, we’ll sign you out before opening its synthetic profiles.</p>
      {error ? <p className="public-demo-error" role="alert">{error}</p> : null}
      <div><Link to="/">Stay in my workspace</Link><button type="button" disabled={leavingAccount} onClick={async()=>{setLeavingAccount(true);setError(null);try{await auth.logout();}catch(reason){setError(reason instanceof Error?reason.message:"The sample campus could not be opened.");setLeavingAccount(false);}}}>{leavingAccount?"Signing out…":"Sign out and explore"}</button></div>
    </section>
  </main>;

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
