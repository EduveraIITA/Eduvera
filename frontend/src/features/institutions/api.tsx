import { apiFetch } from "../../lib/api";

export interface Institution {
  id: string; name: string; institution_type: string; source: "UDISE" | "AISHE" | "MANUAL";
  source_code: string | null; state: string; district: string; city: string; address: string;
  is_verified: boolean; is_onboarded: boolean; eduera_institution_id: string | null;
  onboarding_status: "not_onboarded" | "setup_in_progress" | "active" | "suspended";
  action: "create" | "continue_setup" | "view";
}
export interface ManualDetails { name: string; institution_type: string; state: string; district: string; city: string; address: string }
export const searchInstitutions = (q: string, signal: AbortSignal) => apiFetch<{ results: Institution[] }>(`/api/v1/institutions/search/?${new URLSearchParams({ q })}`, { signal });
export const institutionAction = (item: Institution) => item.is_onboarded ? item.onboarding_status === "setup_in_progress" ? "Continue setup" : "View institution" : "Create Eduera account";

export function InstitutionBadges({ item }: { item: Institution }) {
  return <span className="institution-badges">
    <span className={`institution-badge ${item.source === "MANUAL" ? "is-manual" : "is-official"}`}>{item.source === "MANUAL" ? "Manually added" : item.is_verified ? "✓ Official record" : "Official source · Unverified"}</span>
    <span className={`institution-badge ${item.is_onboarded ? item.onboarding_status === "setup_in_progress" ? "is-pending" : "is-active" : "is-available"}`}>
      {item.onboarding_status === "setup_in_progress" ? "Setup in progress" : item.onboarding_status === "suspended" ? "Already on Eduera · Suspended" : item.is_onboarded ? "✓ Already on Eduera" : item.source === "MANUAL" ? "Not on Eduera" : "Official · Not onboarded"}
    </span>
  </span>;
}
