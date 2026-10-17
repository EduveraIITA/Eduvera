import { useQueryClient } from "@tanstack/react-query";
import {
  Fragment,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../../lib/api";
import { LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { useOptionalAuth } from "../auth/AuthContext";
import {
  LIVE_EXECUTION_ENVIRONMENT,
  executionEnvironmentIdentity,
  isSimulationExecutionEnvironment,
  isUnavailableSimulationExecutionEnvironment,
  normalizeExecutionEnvironment,
  type ExecutionEnvironment,
  type UnavailableSimulationReason,
} from "./executionEnvironment";
import { selectExecutionEnvironment } from "./executionEnvironmentApi";
import { ExecutionEnvironmentProvider } from "./ExecutionEnvironmentContext";
import "./execution-environment-boundary.css";

export const EXECUTION_ENVIRONMENT_SIGNAL_KEY = "thatcampus:execution-environment-changed";
const EXECUTION_ENVIRONMENT_SIGNAL_VERSION = 1;

interface EnvironmentChangedSignal {
  readonly version: typeof EXECUTION_ENVIRONMENT_SIGNAL_VERSION;
  readonly kind: "session-environment-changed";
  readonly senderId: string;
  readonly nonce: string;
}

function tabIdentity() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function isEnvironmentChangedSignal(value: unknown): value is EnvironmentChangedSignal {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const candidate = value as Partial<EnvironmentChangedSignal>;
  return candidate.version === EXECUTION_ENVIRONMENT_SIGNAL_VERSION
    && candidate.kind === "session-environment-changed"
    && typeof candidate.senderId === "string"
    && candidate.senderId.length > 0
    && typeof candidate.nonce === "string"
    && candidate.nonce.length > 0;
}

export type EnvironmentSwitchState = "idle" | "switching";

export interface ApplicationExecutionEnvironmentValue {
  readonly environment: ExecutionEnvironment;
  readonly switchState: EnvironmentSwitchState;
  readonly switchError: string | null;
  readonly expired: boolean;
  enterSimulation: (runId: string) => Promise<boolean>;
  returnToLive: () => Promise<boolean>;
  dismissSwitchError: () => void;
}

const ApplicationExecutionEnvironmentContext = createContext<
  ApplicationExecutionEnvironmentValue | undefined
>(undefined);

export interface ApplicationExecutionEnvironmentProviderProps {
  readonly children: ReactNode;
  /**
   * Test/server-rendering seam. In the application, AuthContext supplies the
   * descriptor read from the authenticated server session.
   */
  readonly confirmedEnvironment?: ExecutionEnvironment | null;
  /** Test seam for cross-document session revalidation. */
  readonly refreshConfirmedEnvironment?: () => Promise<ExecutionEnvironment | null>;
}

function switchFailureMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409) {
    return "That simulation is not ready for the full application. Your Live campus is unchanged.";
  }
  if (error instanceof ApiError && error.status === 410) {
    return "That simulation has expired. Your Live campus is unchanged.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "You no longer have permission to change this environment.";
  }
  return error instanceof Error && error.message
    ? error.message
    : "We couldn't change environments. Your current campus view is unchanged.";
}

function unavailableSimulationMessage(reason: UnavailableSimulationReason) {
  if (reason === "expired") return "This isolated run has expired.";
  if (reason === "authorization_lost") return "Your access to this isolated run is no longer valid.";
  if (reason === "runtime_unavailable") return "The isolated Simulation service is not available after this restart.";
  if (reason === "data_plane_unavailable") return "The isolated campus copy for this run is no longer available.";
  if (reason === "binding_invalid") return "This session no longer matches the institution used by the isolated run.";
  return "This isolated run can no longer be opened.";
}

export function ApplicationExecutionEnvironmentProvider({
  children,
  confirmedEnvironment,
  refreshConfirmedEnvironment,
}: ApplicationExecutionEnvironmentProviderProps) {
  const auth = useOptionalAuth();
  const queryClient = useQueryClient();
  const sessionEnvironment = useMemo(
    () => normalizeExecutionEnvironment(
      confirmedEnvironment !== undefined
        ? confirmedEnvironment ?? LIVE_EXECUTION_ENVIRONMENT
        : auth?.executionEnvironment ?? LIVE_EXECUTION_ENVIRONMENT,
    ),
    [auth?.executionEnvironment, confirmedEnvironment],
  );
  const [environment, setEnvironment] = useState(sessionEnvironment);
  const [switchState, setSwitchState] = useState<EnvironmentSwitchState>("idle");
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [contextBlocked, setContextBlocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const transitionSequence = useRef(0);
  const tabId = useRef(tabIdentity());
  const channel = useRef<BroadcastChannel | null>(null);
  const remoteVerification = useRef<Promise<void> | null>(null);
  const environmentRef = useRef(environment);
  const sessionIdentity = executionEnvironmentIdentity(sessionEnvironment);
  const lastSessionIdentity = useRef(sessionIdentity);

  useEffect(() => {
    environmentRef.current = environment;
  }, [environment]);

  const installConfirmedEnvironment = useCallback(async (next: ExecutionEnvironment) => {
    const normalized = normalizeExecutionEnvironment(next);
    const sequence = ++transitionSequence.current;
    await queryClient.cancelQueries();
    if (sequence !== transitionSequence.current) return false;
    // Every existing key was populated through the previously selected server
    // session. Clearing after confirmation prevents a Live result from appearing
    // beneath a Simulation marker (or the inverse), including legacy unprefixed
    // query keys while modules migrate to environment-partitioned keys.
    queryClient.clear();
    setEnvironment(normalized);
    window.dispatchEvent(new CustomEvent("thatcampus:execution-environment-changed", {
      detail: { environment: normalized.mode },
    }));
    return true;
  }, [queryClient]);

  const announceSessionEnvironmentChange = useCallback(() => {
    const signal: EnvironmentChangedSignal = {
      version: EXECUTION_ENVIRONMENT_SIGNAL_VERSION,
      kind: "session-environment-changed",
      senderId: tabId.current,
      nonce: typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `${Date.now()}:${Math.random()}`,
    };
    try { channel.current?.postMessage(signal); } catch { /* The storage fallback may still notify peer tabs. */ }
    try {
      // Storage is a fallback for browsers without BroadcastChannel. The value
      // deliberately carries no mode, namespace or run identifier: receivers
      // must re-read the authenticated server session.
      window.localStorage.setItem(EXECUTION_ENVIRONMENT_SIGNAL_KEY, JSON.stringify(signal));
      window.localStorage.removeItem(EXECUTION_ENVIRONMENT_SIGNAL_KEY);
    } catch {
      // A blocked storage API does not weaken the active tab's server-confirmed
      // switch; BroadcastChannel remains the preferred coordination path.
    }
  }, []);

  const verifyServerEnvironment = useCallback(() => {
    if (remoteVerification.current) return remoteVerification.current;
    const refresh = refreshConfirmedEnvironment ?? auth?.refresh;
    if (!refresh) return Promise.resolve();

    const verification = (async () => {
      setContextBlocked(true);
      setSwitchState("switching");
      setSwitchError(null);
      await queryClient.cancelQueries();
      try {
        const confirmed = await refresh();
        if (!confirmed) throw new Error("The school service did not confirm the active environment.");
        lastSessionIdentity.current = executionEnvironmentIdentity(confirmed);
        await installConfirmedEnvironment(confirmed);
        setContextBlocked(false);
      } catch {
        setSwitchError("We couldn't verify whether this session is Live or Simulation. Retry before continuing.");
      } finally {
        setSwitchState("idle");
        remoteVerification.current = null;
      }
    })();
    remoteVerification.current = verification;
    return verification;
  }, [auth?.refresh, installConfirmedEnvironment, queryClient, refreshConfirmedEnvironment]);

  useEffect(() => {
    const receive = (value: unknown) => {
      if (!isEnvironmentChangedSignal(value) || value.senderId === tabId.current) return;
      void verifyServerEnvironment();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== EXECUTION_ENVIRONMENT_SIGNAL_KEY || !event.newValue) return;
      try { receive(JSON.parse(event.newValue)); } catch { /* Ignore malformed untrusted signals. */ }
    };
    window.addEventListener("storage", handleStorage);

    if (typeof BroadcastChannel !== "undefined") {
      const activeChannel = new BroadcastChannel(EXECUTION_ENVIRONMENT_SIGNAL_KEY);
      channel.current = activeChannel;
      activeChannel.addEventListener("message", (event) => receive(event.data));
    }
    return () => {
      window.removeEventListener("storage", handleStorage);
      channel.current?.close();
      channel.current = null;
    };
  }, [verifyServerEnvironment]);

  useEffect(() => {
    if (sessionIdentity === lastSessionIdentity.current) return;
    lastSessionIdentity.current = sessionIdentity;
    if (sessionIdentity === executionEnvironmentIdentity(environmentRef.current)) return;
    let active = true;
    void installConfirmedEnvironment(sessionEnvironment).then((installed) => {
      if (!active || !installed) return;
      setSwitchState("idle");
    });
    return () => { active = false; };
  }, [installConfirmedEnvironment, sessionEnvironment, sessionIdentity]);

  const select = useCallback(async (selection: { mode: "live" } | { mode: "simulation"; run_id: string }) => {
    if (switchState === "switching") return false;
    if (queryClient.isMutating() > 0) {
      setSwitchError("Wait for the current action to finish before changing environments.");
      return false;
    }

    setSwitchError(null);
    setSwitchState("switching");
    try {
      const confirmed = await selectExecutionEnvironment(selection);
      await installConfirmedEnvironment(confirmed);
      announceSessionEnvironmentChange();
      setSwitchState("idle");
      return true;
    } catch (error) {
      setSwitchState("idle");
      setSwitchError(switchFailureMessage(error));
      if (error instanceof ApiError && (error.status === 409 || error.status === 410)) {
        // The server may have expired or invalidated the selected fork. Refreshing
        // re-reads the server-authoritative environment; it never guesses Live.
        try {
          await auth?.refresh();
        } catch {
          // Keep the confirmed current environment and the actionable switch
          // error when session refresh is temporarily unavailable.
        }
      }
      return false;
    }
  }, [announceSessionEnvironmentChange, auth, installConfirmedEnvironment, queryClient, switchState]);

  const enterSimulation = useCallback(async (runId: string) => {
    const normalizedRunId = runId.trim();
    if (!normalizedRunId) {
      setSwitchError("Choose a completed simulation before entering it.");
      return false;
    }
    try {
      return await select({ mode: "simulation", run_id: normalizedRunId });
    } catch {
      // `select` is fail-closed, but keep the UI action non-rejecting if a
      // future selector implementation fails before reaching that boundary.
      setSwitchError("We couldn't enter that simulation. Your Live campus is unchanged.");
      return false;
    }
  }, [select]);

  const returnToLive = useCallback(async () => {
    try {
      return await select({ mode: "live" });
    } catch {
      setSwitchError("We couldn't return to Live. This simulation remains isolated.");
      return false;
    }
  }, [select]);

  useEffect(() => {
    if (!isSimulationExecutionEnvironment(environment) || !environment.expiresAt) {
      const resetTimer = window.setTimeout(() => setExpired(false), 0);
      return () => window.clearTimeout(resetTimer);
    }
    const remaining = new Date(environment.expiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      const expiredTimer = window.setTimeout(() => {
        setExpired(true);
        void verifyServerEnvironment();
      }, 0);
      return () => window.clearTimeout(expiredTimer);
    }
    const resetTimer = window.setTimeout(() => setExpired(false), 0);
    const timer = window.setTimeout(() => {
      setExpired(true);
      void verifyServerEnvironment();
    }, Math.min(remaining + 50, 2_147_483_647));
    return () => {
      window.clearTimeout(resetTimer);
      window.clearTimeout(timer);
    };
  }, [environment, verifyServerEnvironment]);

  const value = useMemo<ApplicationExecutionEnvironmentValue>(() => ({
    environment,
    switchState,
    switchError,
    expired,
    enterSimulation,
    returnToLive,
    dismissSwitchError: () => setSwitchError(null),
  }), [enterSimulation, environment, expired, returnToLive, switchError, switchState]);

  const unavailableSimulation = isUnavailableSimulationExecutionEnvironment(environment)
    ? environment
    : null;

  return (
    <ApplicationExecutionEnvironmentContext.Provider value={value}>
      <ExecutionEnvironmentProvider environment={environment}>
        {contextBlocked ? <main className="execution-environment-verification" aria-live="polite" aria-busy={switchState === "switching"}>
          <span className="execution-environment-verification__indicator" aria-hidden="true" />
          <p className="execution-environment-verification__eyebrow">Campus environment</p>
          <h1>{switchState === "switching" ? "Checking this session…" : "Environment not confirmed"}</h1>
          <p>{switchState === "switching"
            ? "ThatCampus is confirming whether this tab is Live or Simulation before it loads campus data."
            : switchError}</p>
          {switchState !== "switching" ? <button type="button" onClick={() => void verifyServerEnvironment()}>Try again</button> : null}
        </main> : unavailableSimulation ? <main
          className="execution-environment-unavailable"
          aria-live="assertive"
          aria-labelledby="simulation-unavailable-title"
        >
          <div className="execution-environment-unavailable__card">
            <div className="execution-environment-unavailable__status">
              <TriangleAlert size={17} aria-hidden="true" />
              <span>Simulation unavailable</span>
            </div>
            <div className="execution-environment-unavailable__icon" aria-hidden="true">
              <TriangleAlert size={28} />
            </div>
            <p className="execution-environment-verification__eyebrow">Isolated campus</p>
            <h1 id="simulation-unavailable-title">Simulation unavailable</h1>
            <p>{unavailableSimulationMessage(unavailableSimulation.unavailableReason)} Live campus data has not been shown or used as a fallback.</p>
            {switchError ? <p className="execution-environment-unavailable__error" role="alert">{switchError}</p> : null}
            <button
              type="button"
              onClick={() => void returnToLive()}
              disabled={switchState === "switching"}
            >
              {switchState === "switching"
                ? <LoaderCircle className="execution-environment-unavailable__spinner" size={18} aria-hidden="true" />
                : <RotateCcw size={18} aria-hidden="true" />}
              <span>{switchState === "switching" ? "Returning…" : "Return to Live"}</span>
            </button>
            <small>You will stay on this page after Live is restored.</small>
          </div>
        </main> : <Fragment key={executionEnvironmentIdentity(environment)}>{children}</Fragment>}
      </ExecutionEnvironmentProvider>
    </ApplicationExecutionEnvironmentContext.Provider>
  );
}

export function useApplicationExecutionEnvironment() {
  const context = useContext(ApplicationExecutionEnvironmentContext);
  if (!context) {
    throw new Error(
      "useApplicationExecutionEnvironment must be used within ApplicationExecutionEnvironmentProvider.",
    );
  }
  return context;
}

export function useOptionalApplicationExecutionEnvironment() {
  return useContext(ApplicationExecutionEnvironmentContext);
}
