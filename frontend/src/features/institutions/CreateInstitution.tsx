import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError } from "../../lib/api";
import { InstitutionSearch } from "./InstitutionSearch";
import { InstitutionBadges, institutionAction, type Institution, type ManualDetails } from "./api";
import { createInstitution, type ReadyInvitation } from "../onboarding/api";
import { normalizeInstitutionCode } from "../onboarding/institution-code";

export function CreateInstitution({ onCreated, onCancel }: { onCreated?: (result: { invitation: ReadyInvitation }) => void; onCancel?: () => void }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Institution | null>(null);
  const [manual, setManual] = useState<ManualDetails | null>(null);
  const [duplicates, setDuplicates] = useState<Institution[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");

  async function create() {
    setBusy(true); setError("");
    try {
      const institution = await createInstitution({
        name: selected?.name ?? manual?.name,
        code: normalizeInstitutionCode(code),
        institution_kind: ["college", "university", "standalone"].includes(selected?.institution_type ?? manual?.institution_type ?? "school") ? "college" : "school",
        timezone, admin_email: email,
        ...(selected ? { directory_id: selected.id } : { manual }),
        acknowledged_duplicate_ids: acknowledged ? duplicates.map((item) => item.eduera_institution_id) : [],
      });
      if (onCreated) onCreated(institution);
      else void navigate(`/company/institutions/${institution.school.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create institution.");
      if (err instanceof ApiError) {
        const data = err.details as { error?: { fields?: { duplicates?: Institution[]; existing?: Institution } } };
        const fields = data.error?.fields;
        if (fields?.duplicates) { setDuplicates(fields.duplicates); setAcknowledged(false); }
        if (fields?.existing) { setSelected(fields.existing); setManual(null); }
      }
    } finally { setBusy(false); }
  }

  return <>
    <p className="institution-step">Search → Confirm details → Create in Eduera → Invite Institution Admin</p>
    {!selected && !manual && <InstitutionSearch onSelect={(item) => {
      if (item.is_onboarded) void navigate(`/company/institutions/${item.eduera_institution_id}`);
      else { setSelected(item); setCode(normalizeInstitutionCode(item.name)); setCodeEdited(false); }
    }} onManual={() => setManual({ name: "", institution_type: "school", state: "", district: "", city: "", address: "" })} />}
    {(selected || manual) && <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <h2>{selected ? "Confirm institution details" : "Add institution manually"}</h2>
      {selected && <div className="institution-selection"><h3>{selected.name}</h3><InstitutionBadges item={selected} />
        <p>{selected.institution_type} · {[selected.city, selected.district, selected.state].filter(Boolean).join(", ")}</p>
        <p>{selected.address || "Address not provided in directory"}</p><p>{selected.source_code && `${selected.source}: ${selected.source_code}`}</p>
      </div>}
      {manual && <div className="institution-fields">
        {(["name", "institution_type", "state", "district", "city", "address"] as const).map((field) => <label key={field}>
          {({ name: "Institution name", institution_type: "Institution type", state: "State", district: "District", city: "City", address: "Address" })[field]}
          {field === "institution_type" ? <select value={manual[field]} onChange={(event) => { setManual({ ...manual, [field]: event.target.value }); setAcknowledged(false); setDuplicates([]); }}>
            {["school", "college", "university", "standalone", "other"].map((type) => <option key={type} value={type}>{type}</option>)}
          </select> : <input value={manual[field]} required={field !== "district" && (field !== "city" || !manual.district.trim())}
            maxLength={field === "name" ? 180 : field === "address" ? 1000 : 120} onChange={(event) => {
              setManual({ ...manual, [field]: event.target.value }); setAcknowledged(false); setDuplicates([]);
              if (field === "name" && !codeEdited) setCode(normalizeInstitutionCode(event.target.value));
            }} />}
        </label>)}
        <small>Provide a district or city. Manual records remain unverified.</small>
      </div>}
      {!selected?.is_onboarded && <div className="institution-fields">
        <label>Unique code<input required minLength={2} maxLength={32} value={code} onChange={event=>{setCodeEdited(true);setCode(event.target.value);}} onBlur={()=>setCode(normalizeInstitutionCode(code))} /></label>
        <label>Timezone<input required maxLength={80} value={timezone} onChange={event=>setTimezone(event.target.value)} /></label>
        <label>First administrator email<input required type="email" maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} /></label>
      </div>}
      {error && <p role="alert" className="institution-error">{error}</p>}
      {duplicates.length > 0 && <div className="institution-duplicates"><h3>Possible existing institutions</h3>
        <p>Review these accounts before creating another institution.</p>
        {duplicates.map((item) => <div key={item.id}><strong>{item.name}</strong><p>{[item.city || item.district, item.state].filter(Boolean).join(", ")}</p>
          <InstitutionBadges item={item} /><a href={`/company/institutions/${item.eduera_institution_id}`}>{institutionAction(item)}</a></div>)}
        <label className="institution-checkbox"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />I reviewed these accounts. This is a different institution.</label>
      </div>}
      <div className="institution-actions"><button type="button" disabled={busy} onClick={() => { setSelected(null); setManual(null); setDuplicates([]); setAcknowledged(false); setError(""); }}>Back to search</button>
        {selected?.is_onboarded ? <a href={`/company/institutions/${selected.eduera_institution_id}`}>{institutionAction(selected)}</a> :
          <button className="institution-primary" disabled={busy || (duplicates.length > 0 && !acknowledged)}>{busy ? "Creating…" : "Create & invite admin"}</button>}
      </div>
    </form>}
    {onCancel && <button type="button" className="institution-text-button" disabled={busy} onClick={onCancel}>Cancel</button>}
  </>;
}
