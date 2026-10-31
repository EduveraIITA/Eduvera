import { TemporalInput } from "../../components/forms/TemporalInput";
import { diningTimeOptions } from "./diningTime";

export function DiningTimeField({ label, value, onChange, timezone, fold, onFold }: { label: string; value: string; onChange: (value: string) => void; timezone: string; fold: string; onFold: (fold: string) => void }) {
  const repeated = diningTimeOptions(value, timezone).length > 1;
  return <div className="dining-field"><label>{label}<TemporalInput type="datetime-local" required step={value.length > 16 ? "any" : 60} value={value} onChange={event => { onChange(event.target.value); onFold(""); }} /></label>{repeated ? <label>{label} occurrence<select required value={fold} onChange={event => onFold(event.target.value)}><option value="">Choose clock occurrence</option><option value="earlier">Earlier occurrence</option><option value="later">Later occurrence</option></select></label> : value && !diningTimeOptions(value, timezone).length ? <p className="dining-error">Choose an existing local time in {timezone}.</p> : null}</div>;
}
