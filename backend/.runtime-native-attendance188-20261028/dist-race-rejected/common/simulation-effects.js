import { ConflictException } from "@nestjs/common";
import { executionEnvironmentStorage } from "../campus-model-core/execution-time.runtime.js";
/** Provider credentials are read only after this environment boundary passes. */
export function assertLiveExternalEffect(label) {
    if (executionEnvironmentStorage.getStore()?.kind === "simulation") {
        throw new ConflictException({ code: "simulation_external_effect_disabled",
            message: `${label} is unavailable in Simulation. No Live service or stored Live evidence was accessed.` });
    }
}
//# sourceMappingURL=simulation-effects.js.map