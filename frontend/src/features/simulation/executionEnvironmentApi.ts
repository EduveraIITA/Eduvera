import { apiFetch } from "../../lib/api";
import {
  executionEnvironmentFromWire,
  type ExecutionEnvironment,
  type ExecutionEnvironmentWireDescriptor,
} from "./executionEnvironment";

interface ExecutionEnvironmentResponse {
  execution_environment: ExecutionEnvironmentWireDescriptor;
}

export type ExecutionEnvironmentSelection =
  | { readonly mode: "live" }
  | { readonly mode: "simulation"; readonly run_id: string };

export async function selectExecutionEnvironment(
  selection: ExecutionEnvironmentSelection,
): Promise<ExecutionEnvironment> {
  const response = await apiFetch<ExecutionEnvironmentResponse>(
    "/api/v1/auth/execution-environment/",
    {
      method: "POST",
      body: JSON.stringify(selection),
    },
  );
  return executionEnvironmentFromWire(response.execution_environment);
}
