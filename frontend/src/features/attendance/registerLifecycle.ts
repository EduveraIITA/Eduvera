export type RegisterStorageState = "draft" | "submitted" | "open" | "locked";

export type RegisterLifecycleState = "draft" | "submitted" | "final";

export function registerLifecycleState(state: RegisterStorageState): RegisterLifecycleState {
  if (state === "locked") return "final";
  if (state === "submitted") return "submitted";
  return "draft";
}

export function registerLifecycleLabel(state: RegisterStorageState): "Draft" | "Submitted" | "Final" {
  const lifecycle = registerLifecycleState(state);
  return lifecycle === "final" ? "Final" : lifecycle === "submitted" ? "Submitted" : "Draft";
}

export function isFinalRegister(state: RegisterStorageState): boolean {
  return registerLifecycleState(state) === "final";
}
