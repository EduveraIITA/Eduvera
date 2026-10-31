import { useRef, useState } from "react";
import { PersonSelector, type PersonSelection } from "./PersonSelector";
import { getParticipant, type ParticipantDetail } from "./participationApi";

export function ImportPersonReference({ schoolId, label, initial, excludeId, onChange }: {
  schoolId: string; label: string; initial: PersonSelection | null; excludeId?: string;
  onChange: (person: ParticipantDetail | null) => void;
}) {
  const [selected, setSelected] = useState(initial), [error, setError] = useState("");
  const generation = useRef(0);
  return <><PersonSelector schoolId={schoolId} label={label} value={selected} excludeId={excludeId} onChange={value => {
    const current = ++generation.current; setSelected(value); setError(""); onChange(null);
    if (value) void getParticipant(schoolId, value.id).then(person => { if (generation.current === current) onChange(person); }).catch(cause => { if (generation.current === current) setError(cause instanceof Error ? cause.message : "Person revision could not be confirmed. Select them again."); });
  }} />{error ? <p role="alert" className="people-error">{error}</p> : null}</>;
}
