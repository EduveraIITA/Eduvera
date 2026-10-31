import { ApiError } from "../../lib/api";

/** A definitive failed receipt permits a new explicit attempt; network uncertainty does not. */
export function isDefinitiveSceneImportFailure(error: unknown): boolean {
  if (!(error instanceof ApiError) || !error.details || typeof error.details !== "object") return false;
  const details = error.details as Record<string, unknown>;
  if (details.code === "campus_import_failed" && details.retry_requires_new_key === true) return true;
  // The shared HTTP filter keeps the durable failure code in its normal error
  // envelope, but does not expose importer-specific receipt fields.
  const envelope = details.error;
  return Boolean(envelope && typeof envelope === "object" && "code" in envelope && envelope.code === "campus_import_failed");
}
