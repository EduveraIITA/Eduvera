import { isSimulationExecutionEnvironment, type ExecutionEnvironment } from "./executionEnvironment";

let confirmedEnvironment: ExecutionEnvironment | null = null;

/** Presentation/date-input clock only; this cannot select the server data plane. */
export function installApplicationClock(environment: ExecutionEnvironment): void {
  confirmedEnvironment = environment;
}

export function releaseApplicationClock(environment: ExecutionEnvironment): void {
  if (confirmedEnvironment === environment) confirmedEnvironment = null;
}

export function applicationNow(): Date {
  return confirmedEnvironment && isSimulationExecutionEnvironment(confirmedEnvironment)
    ? new Date(confirmedEnvironment.virtualClock.now)
    : new Date();
}
