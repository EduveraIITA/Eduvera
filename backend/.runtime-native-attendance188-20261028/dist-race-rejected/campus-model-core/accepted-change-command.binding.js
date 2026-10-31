import { createHash } from "node:crypto";
import { acceptedCampusModelChangeSchema } from "./contracts.js";
function canonical(value) {
    if (Array.isArray(value))
        return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return value;
}
/** Bind a prepared owning-domain command to its exact, typed topology projection. */
export function acceptedChangeProjectionHash(raw) {
    const { prepared_command_id, prepared_request_hash, ...projection } = acceptedCampusModelChangeSchema.parse(raw);
    void prepared_command_id;
    void prepared_request_hash;
    return createHash("sha256").update(JSON.stringify(canonical(projection))).digest("hex");
}
export function acceptedChangeScopeHash(projectionHash, realmId, namespaceId) {
    return createHash("sha256").update(JSON.stringify([realmId, namespaceId, projectionHash])).digest("hex");
}
//# sourceMappingURL=accepted-change-command.binding.js.map