import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createInvalidationBatcher, FULL_SYNC_INVALIDATIONS, resolveSchoolEvent } from "../school/schoolEventProtocol";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { feeQueryRoots } from "./feeQueryKeys";

describe("actual ledger cache invalidation", () => {
  it.each(["fee event", "full sync"])("refreshes actual Live staff/family keys after %s without invalidating a sibling world", async kind => {
    const client = new QueryClient();
    const roots = Object.values(feeQueryRoots);
    const live = roots.map(root => executionEnvironmentQueryKey({ mode: "live" }, [...root, "actor", "campus", "student"]));
    const sibling = ["execution-environment", "simulation", "world", "run", ...feeQueryRoots.ledger, "actor", "campus", "student"];
    for (const key of [...live, sibling]) client.setQueryData(key, { balance: 100 });
    const batcher = createInvalidationBatcher(client);
    try {
      batcher.enqueue(kind === "full sync" ? FULL_SYNC_INVALIDATIONS : resolveSchoolEvent(JSON.stringify({ id: "event", type: "fees.updated",
        created_at: "2026-10-24T06:00:00Z", payload: { refresh: ["fees"] } }), "fees.updated", "actor").invalidations);
      await batcher.flush();
      for (const key of live) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
      expect(client.getQueryState(sibling)?.isInvalidated).toBe(false);
    } finally { batcher.cancel(); client.clear(); }
  });
});
