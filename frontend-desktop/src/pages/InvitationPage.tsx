import { useState } from "react";
import { api } from "../lib/api";
import { RecordForm } from "./administration/RecordForm";
import "./administration/administration.css";

export function InvitationPage() {
  const [accepted, setAccepted] = useState(false);
  return <main className="ops-invitation"><h1>Join your school</h1><p>Use the private invitation code sent by your school administrator.</p>
    {accepted ? <section className="card ops-panel" role="status"><h2>Your school account is ready</h2><p><a href="/login">Sign in to Eduera</a></p></section> :
      <RecordForm title="Accept invitation" submitLabel="Accept invitation" fields={[
        { name: "token", label: "Invitation code" }, { name: "email", label: "Invited email", type: "email" },
        { name: "first_name", label: "First name" }, { name: "last_name", label: "Last name" },
        { name: "password", label: "Password", type: "password" },
      ]} onSave={async (values) => {
        await api("/api/v1/auth/csrf/");
        await api("/api/v1/invitations/accept/", { method: "POST", body: JSON.stringify(values) }); setAccepted(true);
      }}><p>Already have an account? Enter its existing password. Otherwise choose a strong new password. Do not share your password with the school.</p></RecordForm>}
  </main>;
}
