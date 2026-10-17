import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  ExecutionEnvironmentInvariantError,
  isSimulationExecutionEnvironment,
  normalizeExecutionEnvironment,
  type ExecutionEnvironment,
  type SimulationExecutionEnvironment,
} from "./executionEnvironment";

const ExecutionEnvironmentContext = createContext<ExecutionEnvironment | undefined>(
  undefined,
);

export interface ExecutionEnvironmentProviderProps {
  readonly environment: ExecutionEnvironment;
  readonly children: ReactNode;
}

export function ExecutionEnvironmentProvider({
  environment,
  children,
}: ExecutionEnvironmentProviderProps) {
  const value = useMemo(
    () => normalizeExecutionEnvironment(environment),
    [environment],
  );

  return (
    <ExecutionEnvironmentContext.Provider value={value}>
      {children}
    </ExecutionEnvironmentContext.Provider>
  );
}

export function useExecutionEnvironment(): ExecutionEnvironment {
  const environment = useContext(ExecutionEnvironmentContext);
  if (!environment) {
    throw new ExecutionEnvironmentInvariantError(
      "useExecutionEnvironment must be used within an ExecutionEnvironmentProvider.",
    );
  }
  return environment;
}

export function useSimulationExecutionEnvironment(): SimulationExecutionEnvironment {
  const environment = useExecutionEnvironment();
  if (!isSimulationExecutionEnvironment(environment)) {
    throw new ExecutionEnvironmentInvariantError(
      "This surface requires an isolated simulation execution environment.",
    );
  }
  return environment;
}
