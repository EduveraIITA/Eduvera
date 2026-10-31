import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type {
  ConfigureSimulationBehaviourInput,
  SimulationAttendanceBehaviour,
  SimulationBehaviourView,
  SimulationOfferResponseBehaviour,
} from "./simulationApi";

export interface AttendanceBehaviourForm {
  enabled: boolean;
  present: number;
  late: number;
  absent: number;
  excused: number;
  submissionDelayMinutes: number;
}

export interface OfferResponseBehaviourForm {
  enabled: boolean;
  accepted: number;
  declined: number;
  noResponse: number;
  responseDelayMinutes: number;
}

export interface SimulationBehaviourForm {
  attendance: AttendanceBehaviourForm;
  coverageOffers: OfferResponseBehaviourForm;
  invigilationOffers: OfferResponseBehaviourForm;
}

export const DEFAULT_ATTENDANCE_BEHAVIOUR: AttendanceBehaviourForm = {
  enabled: false,
  present: 88,
  late: 4,
  absent: 4,
  excused: 4,
  submissionDelayMinutes: 10,
};

export const DEFAULT_COVERAGE_OFFER_BEHAVIOUR: OfferResponseBehaviourForm = {
  enabled: false,
  accepted: 65,
  declined: 25,
  noResponse: 10,
  responseDelayMinutes: 15,
};

export const DEFAULT_INVIGILATION_OFFER_BEHAVIOUR: OfferResponseBehaviourForm = {
  enabled: false,
  accepted: 75,
  declined: 15,
  noResponse: 10,
  responseDelayMinutes: 60,
};

export const DEFAULT_SIMULATION_BEHAVIOUR: SimulationBehaviourForm = {
  attendance: DEFAULT_ATTENDANCE_BEHAVIOUR,
  coverageOffers: DEFAULT_COVERAGE_OFFER_BEHAVIOUR,
  invigilationOffers: DEFAULT_INVIGILATION_OFFER_BEHAVIOUR,
};

export function attendanceBehaviourFromRun(
  behaviour: SimulationAttendanceBehaviour | null | undefined,
): AttendanceBehaviourForm {
  if (!behaviour) return { ...DEFAULT_ATTENDANCE_BEHAVIOUR };
  return {
    enabled: behaviour.enabled,
    present: behaviour.present * 100,
    late: behaviour.late * 100,
    absent: behaviour.absent * 100,
    excused: behaviour.excused * 100,
    submissionDelayMinutes: behaviour.submission_delay_minutes,
  };
}

export function offerResponseBehaviourFromRun(
  behaviour: SimulationOfferResponseBehaviour | null | undefined,
  fallback: OfferResponseBehaviourForm,
): OfferResponseBehaviourForm {
  if (!behaviour) return { ...fallback };
  return {
    enabled: behaviour.enabled,
    accepted: behaviour.accepted * 100,
    declined: behaviour.declined * 100,
    noResponse: behaviour.no_response * 100,
    responseDelayMinutes: behaviour.response_delay_minutes,
  };
}

export function simulationBehaviourFromRun(
  behaviour: SimulationBehaviourView | null | undefined,
): SimulationBehaviourForm {
  return {
    attendance: attendanceBehaviourFromRun(behaviour?.attendance),
    coverageOffers: offerResponseBehaviourFromRun(behaviour?.coverage_offers, DEFAULT_COVERAGE_OFFER_BEHAVIOUR),
    invigilationOffers: offerResponseBehaviourFromRun(behaviour?.invigilation_offers, DEFAULT_INVIGILATION_OFFER_BEHAVIOUR),
  };
}

export function attendanceBehaviourInput(value: AttendanceBehaviourForm): SimulationAttendanceBehaviour {
  const total = value.present + value.late + value.absent + value.excused;
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(`Attendance outcomes must total 100%. They currently total ${total}%.`);
  }
  if (!Number.isInteger(value.submissionDelayMinutes) || value.submissionDelayMinutes < 0 || value.submissionDelayMinutes > 120) {
    throw new Error("Attendance submission delay must be a whole number from 0 to 120 minutes.");
  }
  return {
    enabled: value.enabled,
    present: value.present / 100,
    late: value.late / 100,
    absent: value.absent / 100,
    excused: value.excused / 100,
    submission_delay_minutes: value.submissionDelayMinutes,
  };
}

export function offerResponseBehaviourInput(
  value: OfferResponseBehaviourForm,
  label: string,
): SimulationOfferResponseBehaviour {
  const total = value.accepted + value.declined + value.noResponse;
  if (Math.abs(total - 100) > 0.001) {
    throw new Error(`${label} outcomes must total 100%. They currently total ${total}%.`);
  }
  if (!Number.isInteger(value.responseDelayMinutes)
    || value.responseDelayMinutes < 0
    || value.responseDelayMinutes > 10_080) {
    throw new Error(`${label} response delay must be a whole number from 0 to 10080 minutes.`);
  }
  return {
    enabled: value.enabled,
    accepted: value.accepted / 100,
    declined: value.declined / 100,
    no_response: value.noResponse / 100,
    response_delay_minutes: value.responseDelayMinutes,
  };
}

export function simulationBehaviourInput(
  value: SimulationBehaviourForm,
): ConfigureSimulationBehaviourInput {
  return {
    schema_version: 2,
    attendance: attendanceBehaviourInput(value.attendance),
    coverage_offers: offerResponseBehaviourInput(value.coverageOffers, "Coverage offer"),
    invigilation_offers: offerResponseBehaviourInput(value.invigilationOffers, "Invigilation offer"),
  };
}

export function isSimulationBehaviourEnabled(value: SimulationBehaviourForm) {
  return value.attendance.enabled || value.coverageOffers.enabled || value.invigilationOffers.enabled;
}

interface SimulationBehaviourEditorProps {
  value: SimulationBehaviourForm;
  onChange: (value: SimulationBehaviourForm) => void;
}

type DetailsKey = "attendance" | "coverage" | "invigilation";

interface ModelShellProps {
  checked: boolean;
  description: string;
  detailsId: string;
  detailsLabel: string;
  detailsOpen: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  onDetailsChange: () => void;
  summary: string;
  children: ReactNode;
}

function ModelShell({
  checked,
  description,
  detailsId,
  detailsLabel,
  detailsOpen,
  label,
  onCheckedChange,
  onDetailsChange,
  summary,
  children,
}: ModelShellProps) {
  return (
    <div className="simulation-behaviour__model">
      <label className="simulation-check-field">
        <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
        <span><strong>{label}</strong><small>{description}</small></span>
      </label>
      {checked ? (
        <div className="simulation-behaviour__enabled">
          <div className="simulation-behaviour__summary">
            <p>{summary}</p>
            <button type="button" aria-controls={detailsId} aria-expanded={detailsOpen} onClick={onDetailsChange}>
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>{detailsOpen ? `Hide ${detailsLabel}` : `Adjust ${detailsLabel}`}</span>
              <ChevronDown className={detailsOpen ? "is-open" : undefined} size={16} aria-hidden="true" />
            </button>
          </div>
          {detailsOpen ? <div id={detailsId} className="simulation-behaviour__settings">{children}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function numberValue(raw: string) {
  const next = Number(raw);
  return Number.isFinite(next) ? next : 0;
}

export function SimulationBehaviourEditor({ value, onChange }: SimulationBehaviourEditorProps) {
  const [openDetails, setOpenDetails] = useState<DetailsKey | null>(null);
  const [expanded, setExpanded] = useState(() => isSimulationBehaviourEnabled(value));
  const panelId = useId();
  const enabledCount = [value.attendance.enabled, value.coverageOffers.enabled, value.invigilationOffers.enabled].filter(Boolean).length;
  const attendanceTotal = value.attendance.present + value.attendance.late
    + value.attendance.absent + value.attendance.excused;
  const coverageTotal = value.coverageOffers.accepted + value.coverageOffers.declined
    + value.coverageOffers.noResponse;
  const invigilationTotal = value.invigilationOffers.accepted + value.invigilationOffers.declined
    + value.invigilationOffers.noResponse;

  const setAttendanceNumber = (
    key: "present" | "late" | "absent" | "excused" | "submissionDelayMinutes",
    raw: string,
  ) => onChange({ ...value, attendance: { ...value.attendance, [key]: numberValue(raw) } });

  const setOfferNumber = (
    model: "coverageOffers" | "invigilationOffers",
    key: "accepted" | "declined" | "noResponse" | "responseDelayMinutes",
    raw: string,
  ) => onChange({ ...value, [model]: { ...value[model], [key]: numberValue(raw) } });

  const toggleDetails = (key: DetailsKey) => setOpenDetails((current) => current === key ? null : key);

  return (
    <section className="simulation-behaviour-options">
      <button type="button" className="simulation-behaviour-options__toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded((current) => !current)}>
        <span><strong>Synthetic activity models</strong><small>{enabledCount ? `${enabledCount} active · Run-only assumptions` : "Optional · Counterparts stay passive until enabled"}</small></span>
        <ChevronDown size={18} aria-hidden="true" className={expanded ? "is-open" : undefined} />
      </button>
      {expanded ? <fieldset id={panelId} className="simulation-behaviour">
      <legend className="sr-only">Synthetic activity models</legend>
      <p className="simulation-behaviour__intro">
        Declare run-only cohort assumptions. They exercise normal recipient, revision, authority and conflict checks; they never claim to predict an identified person's intent.
      </p>

      <ModelShell
        checked={value.attendance.enabled}
        description="Create synthetic routine check-ins from a declared cohort distribution."
        detailsId="simulation-attendance-pattern"
        detailsLabel="attendance pattern"
        detailsOpen={openDetails === "attendance"}
        label="Model routine attendance"
        onCheckedChange={(enabled) => {
          if (!enabled && openDetails === "attendance") setOpenDetails(null);
          onChange({ ...value, attendance: { ...value.attendance, enabled } });
        }}
        onDetailsChange={() => toggleDetails("attendance")}
        summary={`${value.attendance.present}% present · ${value.attendance.late}% late · ${value.attendance.absent}% absent · ${value.attendance.excused}% excused · submit after ${value.attendance.submissionDelayMinutes} min`}
      >
        <div className="simulation-behaviour__outcomes simulation-behaviour__outcomes--attendance">
          {(["present", "late", "absent", "excused"] as const).map((key) => (
            <label key={key} className="simulation-field">
              <span>{key[0]!.toUpperCase()}{key.slice(1)} <small>%</small></span>
              <input type="number" min="0" max="100" step="1" inputMode="decimal" value={value.attendance[key]} onChange={(event) => setAttendanceNumber(key, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="simulation-behaviour__footer">
          <label className="simulation-field">
            <span>Submit after <small>minutes</small></span>
            <input type="number" min="0" max="120" step="1" inputMode="numeric" value={value.attendance.submissionDelayMinutes} onChange={(event) => setAttendanceNumber("submissionDelayMinutes", event.target.value)} />
          </label>
          <p className={Math.abs(attendanceTotal - 100) <= 0.001 ? "is-valid" : "is-invalid"} role="status">Outcome total <strong>{attendanceTotal}%</strong></p>
        </div>
      </ModelShell>

      <ModelShell
        checked={value.coverageOffers.enabled}
        description="Let synthetic staff counterparts answer existing coverage Offers after the chosen delay."
        detailsId="simulation-coverage-offer-pattern"
        detailsLabel="coverage response pattern"
        detailsOpen={openDetails === "coverage"}
        label="Model coverage offer responses"
        onCheckedChange={(enabled) => {
          if (!enabled && openDetails === "coverage") setOpenDetails(null);
          onChange({ ...value, coverageOffers: { ...value.coverageOffers, enabled } });
        }}
        onDetailsChange={() => toggleDetails("coverage")}
        summary={`${value.coverageOffers.accepted}% accept · ${value.coverageOffers.declined}% decline · ${value.coverageOffers.noResponse}% no response · after ${value.coverageOffers.responseDelayMinutes} min`}
      >
        <OfferSettings model="coverageOffers" value={value.coverageOffers} total={coverageTotal} onNumberChange={setOfferNumber} />
      </ModelShell>

      <ModelShell
        checked={value.invigilationOffers.enabled}
        description="Let synthetic staff counterparts answer existing invigilation Offers after the chosen delay."
        detailsId="simulation-invigilation-offer-pattern"
        detailsLabel="invigilation response pattern"
        detailsOpen={openDetails === "invigilation"}
        label="Model invigilation offer responses"
        onCheckedChange={(enabled) => {
          if (!enabled && openDetails === "invigilation") setOpenDetails(null);
          onChange({ ...value, invigilationOffers: { ...value.invigilationOffers, enabled } });
        }}
        onDetailsChange={() => toggleDetails("invigilation")}
        summary={`${value.invigilationOffers.accepted}% accept · ${value.invigilationOffers.declined}% decline · ${value.invigilationOffers.noResponse}% no response · after ${value.invigilationOffers.responseDelayMinutes} min`}
      >
        <OfferSettings model="invigilationOffers" value={value.invigilationOffers} total={invigilationTotal} onNumberChange={setOfferNumber} />
      </ModelShell>

      <p className="simulation-behaviour__note">
        Enabled policies are versioned, administrator-approved and confined to this run. Disabled counterparts remain passive. Domain rules may still refuse a sampled response.
      </p>
      </fieldset> : null}
    </section>
  );
}

function OfferSettings({
  model,
  onNumberChange,
  total,
  value,
}: {
  model: "coverageOffers" | "invigilationOffers";
  onNumberChange: (
    model: "coverageOffers" | "invigilationOffers",
    key: "accepted" | "declined" | "noResponse" | "responseDelayMinutes",
    raw: string,
  ) => void;
  total: number;
  value: OfferResponseBehaviourForm;
}) {
  return (
    <>
      <div className="simulation-behaviour__outcomes">
        {([
          ["accepted", "Accept"],
          ["declined", "Decline"],
          ["noResponse", "No response"],
        ] as const).map(([key, label]) => (
          <label key={key} className="simulation-field">
            <span>{label} <small>%</small></span>
            <input type="number" min="0" max="100" step="1" inputMode="decimal" value={value[key]} onChange={(event) => onNumberChange(model, key, event.target.value)} />
          </label>
        ))}
      </div>
      <div className="simulation-behaviour__footer">
        <label className="simulation-field">
          <span>Respond after <small>minutes</small></span>
          <input type="number" min="0" max="10080" step="1" inputMode="numeric" value={value.responseDelayMinutes} onChange={(event) => onNumberChange(model, "responseDelayMinutes", event.target.value)} />
        </label>
        <p className={Math.abs(total - 100) <= 0.001 ? "is-valid" : "is-invalid"} role="status">Outcome total <strong>{total}%</strong></p>
      </div>
    </>
  );
}
