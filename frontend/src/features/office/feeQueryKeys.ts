/** Domain roots shared by ledger queries and realtime/full-sync invalidation. */
export const feeQueryRoots = {
  ledger: ["office", "fees"], family: ["office", "family-fees"],
  students: ["office", "fee-students"], gateway: ["office", "fee-gateway-review"],
} as const;
export const feeQueryInvalidations = Object.values(feeQueryRoots).map(queryKey => ({ queryKey, environmentScoped: true as const }));
