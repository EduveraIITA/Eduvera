import { ApiError } from "../../lib/api";

/** Keep the same actor/world editor on transport failures; never keep a revoked source open. */
export const assignmentAccessLost = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
