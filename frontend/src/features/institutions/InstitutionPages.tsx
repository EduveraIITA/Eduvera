import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../auth/AuthContext";
import { CreateInstitution } from "./CreateInstitution";
import { InstitutionBadges, type Institution } from "./api";
import "./institutions.css";

export function CompanyInstitutionsPage() {
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState("");
  const { id } = useParams();
  useEffect(() => {
    let cancelled = false;
    void apiFetch("/api/v1/institutions/operator/").then(() => { if (!cancelled) setAllowed(true); }).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Unable to verify company access.");
    });
    return () => { cancelled = true; };
  }, []);
  return <main className="institution-page"><header><Link to="/">Eduera</Link><span>Super Admin</span></header>
    <section className="institution-panel"><h1>{id ? "Institution" : "Create Institution"}</h1>
      {error ? <p role="alert">{error}</p> : !allowed ? <p role="status">Checking company access…</p> : id ? <InstitutionDetail key={id} id={id} /> : <CreateInstitution />}
    </section></main>;
}

function InstitutionDetail({ id }: { id: string }) {
  const [institution, setInstitution] = useState<Institution | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch<Institution>(`/api/v1/institutions/${id}/`, { signal: controller.signal }).then(setInstitution).catch((err: unknown) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load institution.");
    });
    return () => controller.abort();
  }, [id]);
  async function invite() {
    setBusy(true); setError(""); setCode("");
    try {
      const result = await apiFetch<{ token: string }>(`/api/v1/institutions/${id}/admin-invitations/`, { method: "POST", body: JSON.stringify({ email }) });
      setCode(result.token);
    } catch (err) { setError(err instanceof Error ? err.message : "Invitation failed."); }
    finally { setBusy(false); }
  }
  return <>
    <Link to="/company">Create another institution</Link>
    {error && <p role="alert" className="institution-error">{error}</p>}
    {institution ? <><h2>{institution.name}</h2><InstitutionBadges item={institution} /><p>{[institution.city, institution.district, institution.state].filter(Boolean).join(", ")}</p><p>{institution.address}</p>
      {institution.source_code && <p>{institution.source}: {institution.source_code}</p>}
      {institution.onboarding_status !== "suspended" && <form onSubmit={(event) => { event.preventDefault(); void invite(); }}>
        <h2>{institution.onboarding_status === "setup_in_progress" ? "Continue setup" : "Invite Institution Admin"}</h2>
        <p>Create a private invitation for the institution administrator. A replacement invalidates any pending invitation.</p>
        <label>Administrator email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="institution-primary" disabled={busy}>{busy ? "Creating invitation…" : "Create admin invitation"}</button>
      </form>}
      {code && <div role="status" className="institution-invitation"><h3>Invitation ready to share</h3><p>Share this code privately with {email}. It expires in 72 hours and can be used once. No email has been sent.</p>
        <label>Invitation code<input readOnly value={code} onFocus={(event) => event.target.select()} /></label>
        <p>Ask the administrator to sign in or create an account with the invited email, then open <Link to="/join-institution">{window.location.origin}/join-institution</Link>.</p>
      </div>}
    </> : !error && <p role="status">Loading institution…</p>}
  </>;
}

export function AcceptInstitutionInvitationPage() {
  const auth = useAuth();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function accept() {
    setBusy(true); setError("");
    try {
      await apiFetch("/api/v1/institutions/accept-invitation/", { method: "POST", body: JSON.stringify({ token: token.trim() }) });
      await auth.refresh(); setDone(true); setToken("");
    } catch (err) { setError(err instanceof Error ? err.message : "Unable to accept invitation."); }
    finally { setBusy(false); }
  }
  return <main className="institution-page"><section className="institution-panel"><h1>Join your institution</h1>
    {done ? <p role="status">Administrator access is ready. <Link to="/principal">Open institution workspace</Link></p> :
      <form onSubmit={(event) => { event.preventDefault(); void accept(); }}><p>Signed in as {auth.user?.email}. Use the code shared by Eduera.</p>
        <label>Invitation code<input required autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} /></label>
        {error && <p role="alert">{error}</p>}<button className="institution-primary" disabled={busy}>{busy ? "Accepting…" : "Accept invitation"}</button>
      </form>}
  </section></main>;
}
