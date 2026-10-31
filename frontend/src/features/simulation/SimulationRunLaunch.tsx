import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  LoaderCircle,
  Play,
  ShieldCheck,
} from "lucide-react";
import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { TemporalInput } from "../../components/forms/TemporalInput";
import { ProductIcon } from "../../components/ProductIcon";
import { useApplicationExecutionEnvironment } from "./ApplicationExecutionEnvironment";
import {
  DEFAULT_SIMULATION_BEHAVIOUR,
  isSimulationBehaviourEnabled,
  simulationBehaviourInput,
  SimulationBehaviourEditor,
} from "./SimulationBehaviourEditor";
import {
  configureSimulationBehaviour,
  createSimulationRun,
  getSimulationRun,
  startSimulationRun,
  type CreateSimulationRunInput,
  type SimulationRunKind,
} from "./simulationApi";
import { focusSimulationHeading } from "./simulationFocus";
import { SimulationActionError, simulationCapacityResource } from "./SimulationActionError";

const SPEED_OPTIONS = [1, 5, 10, 20, 50, 100] as const;

function idempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `simulation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function toInstant(value: string) {
  if (!value) return null;
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Choose a valid end date and time.");
  if (instant.getTime() <= Date.now()) throw new Error("The end date and time must be in the future.");
  return instant.toISOString();
}

interface LaunchSettings {
  name: string;
  speed: number;
  hasEnd: boolean;
  endLocal: string;
}

const INITIAL_SETTINGS: LaunchSettings = {
  name: "",
  speed: 20,
  hasEnd: false,
  endLocal: "",
};

interface SimulationRunLaunchProps {
  schoolId: string;
}

export function SimulationRunLaunch({ schoolId }: SimulationRunLaunchProps) {
  const queryClient = useQueryClient();
  const applicationEnvironment = useApplicationExecutionEnvironment();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settings, setSettings] = useState<LaunchSettings>(INITIAL_SETTINGS);
  const [behaviour, setBehaviour] = useState(DEFAULT_SIMULATION_BEHAVIOUR);
  const [localError, setLocalError] = useState<unknown>(null);
  const [pendingKind, setPendingKind] = useState<SimulationRunKind | null>(null);
  const launchInFlight = useRef(false);
  const preparedBaseline = useRef<string | null>(null);
  const baselineIntent = useRef<CreateSimulationRunInput | null>(null);
  const configuredBaseline = useRef(false);
  const startedBaseline = useRef(false);
  const startUnconfirmed = useRef(false);
  const [savedBaselineId, setSavedBaselineId] = useState<string | null>(null);
  const [capturePinned, setCapturePinned] = useState(false);
  const [baselineStarted, setBaselineStarted] = useState(false);
  const requestKeys = useRef<Record<SimulationRunKind, string | null>>({ baseline: null, scenario: null });
  const baselineHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousBaselineStep = useRef(false);
  const isBaselineStep = searchParams.get("step") === "baseline";

  useLayoutEffect(() => {
    const returningToChoices = previousBaselineStep.current && !isBaselineStep;
    previousBaselineStep.current = isBaselineStep;
    if (!isBaselineStep && !returningToChoices) return;
    focusSimulationHeading(isBaselineStep
      ? baselineHeadingRef.current
      : document.getElementById("simulation-launch-title"));
  }, [isBaselineStep]);

  const invalidateHistory = async () => queryClient.invalidateQueries({
    queryKey: ["execution-environment", "live", "simulation-runs", schoolId],
  });

  const resetPresentationForRun = () => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const key of ["panel", "step", "page", "compare", "view", "changePage", "changesPage", "effectsPage"]) next.delete(key);
      return next;
    }, { replace: true });
  };

  const enterPreparedRun = async (runId: string) => {
    resetPresentationForRun();
    const entered = await applicationEnvironment.enterSimulation(runId);
    if (!entered) {
      throw new Error("The run was created, but this session could not open it. You can retry from Recent simulations.");
    }
  };

  const createScenario = async () => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setPendingKind("scenario");
    setLocalError(null);
    try {
      requestKeys.current.scenario ??= idempotencyKey();
      const prepared = await createSimulationRun(schoolId, {
        kind: "scenario",
        speed: 20,
        end_at: null,
        idempotency_key: requestKeys.current.scenario,
      });
      if (!prepared.run.can_open) {
        throw new Error("The scenario was captured, but its isolated campus is not ready to open yet. Find it under Recent simulations and try again.");
      }
      await enterPreparedRun(prepared.run.id);
      requestKeys.current.scenario = null;
      await invalidateHistory();
    } catch (error) {
      setLocalError(error);
    } finally {
      launchInFlight.current = false;
      setPendingKind(null);
    }
  };

  const createBaseline = async () => {
    if (launchInFlight.current) return;
    launchInFlight.current = true;
    setPendingKind("baseline");
    setLocalError(null);
    try {
      if (startedBaseline.current && preparedBaseline.current) {
        await enterPreparedRun(preparedBaseline.current);
        requestKeys.current.baseline = null;
        await invalidateHistory();
        return;
      }
      const endAt = baselineIntent.current ? baselineIntent.current.end_at ?? null : settings.hasEnd ? toInstant(settings.endLocal) : null;
      const behaviourInput = isSimulationBehaviourEnabled(behaviour)
        ? simulationBehaviourInput(behaviour)
        : null;
      requestKeys.current.baseline ??= idempotencyKey();
      baselineIntent.current ??= {
        kind: "baseline",
        ...(settings.name.trim() ? { name: settings.name.trim() } : {}),
        speed: settings.speed,
        end_at: endAt,
        idempotency_key: requestKeys.current.baseline,
      };
      setCapturePinned(true);
      const preparedId = preparedBaseline.current ?? (await createSimulationRun(schoolId, baselineIntent.current)).run.id;
      preparedBaseline.current = preparedId;
      setSavedBaselineId(preparedId);
      if (startUnconfirmed.current) {
        const latest = await getSimulationRun(schoolId, preparedId);
        if (latest.run.status !== "draft") {
          if (!latest.run.can_open) throw new Error("This saved baseline cannot be opened. Review it in Recent simulations.");
          startedBaseline.current = true;
          setBaselineStarted(true);
          await enterPreparedRun(preparedId);
          await invalidateHistory();
          return;
        }
      }
      if (behaviourInput && !configuredBaseline.current) {
        await configureSimulationBehaviour(schoolId, preparedId, behaviourInput);
        configuredBaseline.current = true;
      }
      startUnconfirmed.current = true;
      const ready = await startSimulationRun(schoolId, preparedId, {
        speed: settings.speed,
        end_at: endAt,
      });
      startUnconfirmed.current = false;
      startedBaseline.current = true;
      setBaselineStarted(true);
      if (!ready.run.can_open) {
        throw new Error("The baseline was started, but its isolated campus is not ready to open yet. Find it under Recent simulations and try again.");
      }
      await enterPreparedRun(ready.run.id);
      requestKeys.current.baseline = null;
      await invalidateHistory();
    } catch (error) {
      if (!preparedBaseline.current && ["worlds", "storage"].includes(simulationCapacityResource(error) ?? "")) {
        baselineIntent.current = null;
        setCapturePinned(false);
        requestKeys.current.baseline = null;
      }
      setLocalError(error);
    } finally {
      launchInFlight.current = false;
      setPendingKind(null);
    }
  };

  const showBaselineSettings = () => {
    setLocalError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("panel", "start");
      next.set("step", "baseline");
      return next;
    });
  };

  const closeBaselineSettings = () => {
    if (pendingKind) return;
    setLocalError(null);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("step");
      return next;
    });
  };

  const resetBaselineRequest = () => {
    if (preparedBaseline.current || baselineIntent.current) return;
    requestKeys.current.baseline = null;
  };

  const manageRuns = (saved: boolean) => setSearchParams(current => {
    const next = new URLSearchParams(current);
    next.set("panel", "recent");
    if (saved) next.set("manage", "storage"); else next.delete("manage");
    next.delete("step"); next.delete("page");
    return next;
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void createBaseline();
  };

  return (
    <section className={`simulation-launch${isBaselineStep ? " simulation-launch--focused" : ""}`} aria-labelledby={isBaselineStep ? "simulation-baseline-settings-title" : "simulation-launch-title"}>
      {!isBaselineStep ? (
        <>
          <header className="simulation-section-heading">
            <div>
              <h2 id="simulation-launch-title" tabIndex={-1}>Choose a starting point</h2>
              <p>Nothing runs until you press Start. Live stays unchanged.</p>
            </div>
          </header>

          <div className="simulation-launch__choices">
            <button type="button" className="simulation-launch-choice" aria-label="Set up baseline" aria-describedby="simulation-baseline-choice-help" onClick={showBaselineSettings} disabled={pendingKind !== null}>
              <ProductIcon name="schedule" size={30} />
              <span><strong>Set up baseline</strong><span id="simulation-baseline-choice-help">Use the campus as it is. Choose speed and duration next.</span></span>
              <ChevronRight size={20} aria-hidden="true" />
            </button>
            <button type="button" className="simulation-launch-choice" aria-label="Create scenario draft" aria-describedby="simulation-scenario-choice-help" onClick={() => void createScenario()} disabled={pendingKind !== null}>
              <ProductIcon name="simulation" size={30} />
              <span><strong>{pendingKind === "scenario" ? "Creating draft…" : "Create scenario draft"}</strong><span id="simulation-scenario-choice-help">Try changes in an isolated copy before starting.</span></span>
              {pendingKind === "scenario" ? <LoaderCircle className="simulation-workspace__spinner" size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
            </button>
          </div>
          <SimulationActionError error={localError} onManage={manageRuns} />
          {savedBaselineId ? <button type="button" className="simulation-text-button" disabled={pendingKind !== null} onClick={() => startedBaseline.current ? void enterPreparedRun(savedBaselineId).catch(setLocalError) : showBaselineSettings()}>{baselineStarted ? "Open saved baseline" : "Continue saved baseline"}</button> : null}
        </>
      ) : (
        <form className="simulation-launch__form" onSubmit={submit} aria-busy={pendingKind === "baseline"}>
          <button type="button" className="simulation-text-button" onClick={closeBaselineSettings} disabled={pendingKind !== null}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to choices
          </button>
          <div className="simulation-launch__form-heading">
            <span className="simulation-launch-card__icon" aria-hidden="true"><Play size={21} /></span>
            <div>
              <h2 id="simulation-baseline-settings-title" ref={baselineHeadingRef} tabIndex={-1}>Baseline settings</h2>
              <p>Review the settings, then start your isolated run.</p>
            </div>
          </div>

          <fieldset className="simulation-launch__settings" disabled={pendingKind !== null || capturePinned}>
          <div className="simulation-form-grid">
            <label className="simulation-field">
              <span>Name <small>Optional</small></span>
              <input type="text" value={settings.name} maxLength={80} placeholder="Current campus baseline" onChange={(event) => {
                resetBaselineRequest();
                setSettings((current) => ({ ...current, name: event.target.value }));
              }} />
            </label>

            <label className="simulation-field">
              <span>Simulation speed</span>
              <select value={settings.speed} onChange={(event) => {
                resetBaselineRequest();
                setSettings((current) => ({ ...current, speed: Number(event.target.value) }));
              }}>
                {SPEED_OPTIONS.map((speed) => <option key={speed} value={speed}>{speed}× speed</option>)}
              </select>
              <small>At 20×, one real minute advances twenty simulated minutes.</small>
            </label>
          </div>

          <fieldset className="simulation-end-setting">
            <legend>Run duration</legend>
            <label className="simulation-check-field">
              <input type="checkbox" checked={settings.hasEnd} onChange={(event) => {
                resetBaselineRequest();
                setSettings((current) => ({ ...current, hasEnd: event.target.checked }));
              }} />
              <span><strong>Stop at a simulated date and time</strong><small>Leave this off to keep running until an administrator stops it.</small></span>
            </label>
            {settings.hasEnd ? (
              <label className="simulation-field simulation-field--end">
                <span>End date and time <small>Device time</small></span>
                <TemporalInput
                  type="datetime-local"
                  value={settings.endLocal}
                  required
                  onChange={(event) => {
                    const endLocal = event.currentTarget.value;
                    resetBaselineRequest();
                    setSettings((current) => ({ ...current, endLocal }));
                  }}
                />
              </label>
            ) : null}
          </fieldset>

          <SimulationBehaviourEditor value={behaviour} onChange={(value) => {
            resetBaselineRequest();
            setBehaviour(value);
          }} />
          </fieldset>

          <div className="simulation-launch__assurance">
            <ShieldCheck size={18} aria-hidden="true" />
            <p><strong>Live remains untouched.</strong> Real messages, devices and connectors are blocked from this world.</p>
          </div>

          <SimulationActionError error={localError} onManage={manageRuns} />
          {savedBaselineId ? <p className="simulation-saved-status">Your snapshot is saved. Retry starts this same run.</p> : null}
          <button type="submit" className="simulation-button simulation-button--primary simulation-launch__submit" disabled={pendingKind !== null}>
            {pendingKind === "baseline" ? <LoaderCircle className="simulation-workspace__spinner" size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
            {pendingKind === "baseline" ? "Preparing isolated campus…" : savedBaselineId ? baselineStarted ? "Open saved baseline" : "Start saved baseline" : capturePinned ? "Retry snapshot" : "Start baseline simulation"}
          </button>
        </form>
      )}
    </section>
  );
}
