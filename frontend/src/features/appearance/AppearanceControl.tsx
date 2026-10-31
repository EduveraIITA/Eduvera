import { Monitor, Moon, Sun } from "lucide-react";
import { useId } from "react";
import { setAppearance, useAppearance, type AppearancePreference } from "./appearance";
import "./appearance.css";

const choices: Array<{ value: AppearancePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

export function AppearanceControl({ compact = false }: { compact?: boolean }) {
  const groupId = useId();
  const appearance = useAppearance();
  return <fieldset className={`appearance-control${compact ? " appearance-control--compact" : ""}`}>
    <legend>Appearance</legend>
    {!compact ? <p>Choose how ThatCampus looks on this device.</p> : null}
    <div className="appearance-control__options">
      {choices.map(({ value, label, icon: Icon }) => <label key={value} className="appearance-control__option">
        <input
          type="radio"
          name={`thatcampus-appearance-${groupId}`}
          value={value}
          checked={appearance.preference === value}
          onChange={() => setAppearance(value)}
        />
        <Icon size={compact ? 16 : 18} aria-hidden="true" />
        <span>{label}</span>
      </label>)}
    </div>
  </fieldset>;
}
