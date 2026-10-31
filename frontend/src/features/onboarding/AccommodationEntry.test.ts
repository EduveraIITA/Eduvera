import { describe, expect, it } from "vitest";
import { capabilityReadinessPresentation } from "./capabilityReadinessPresentation";
import { goalIconNames } from "./StartingPoints";
import type { AccommodationOperationReadiness, CapabilityReadiness } from "./progressive-api";
describe("Accommodation progressive purpose", () => {
  it.each<[AccommodationOperationReadiness["state"], string]>([["needs_rooms", "Add a room"], ["ready_to_offer", "Assign room"], ["offer_recorded", "Continue offer"], ["arrangement_recorded", "Open stay"], ["unavailable", "Review accommodation access"]])("presents %s without treating setup or an offer as acceptance", (state, action) => {
    const operation: AccommodationOperationReadiness = { state, action: "view", actor_user_id: "actor", environment_namespace_id: "live", scope: state === "offer_recorded" || state === "arrangement_recorded" ? { kind: "stay", id: "stay-1" } : null, source_revision: null, evaluated_at: "2026-10-24T09:00:00Z", requires_recheck: true, destination: "/areas/accommodation" };
    const item: CapabilityReadiness = { capability: "accommodation", label: "Accommodation", status: state === "arrangement_recorded" ? "working" : "needs_setup", destination: operation.destination, setup_path: "/more/setup/capabilities?task=accommodation", counts: {}, missing: [], accommodation_operation: operation };
    expect(capabilityReadinessPresentation(item).action).toBe(action); expect(goalIconNames.accommodation).toBe("accommodation");
  });
});
