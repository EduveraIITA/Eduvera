/** Presentation-only capture transform. Geometry, canonical place/image IDs and
 * immutable original command hashes remain intact. Private acquisition notes,
 * provider names and URLs are unnecessary for an isolated campus rehearsal. */
function capturedProposal(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(capturedProposal);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  if (
    object.schema_version === 1 &&
    object.bounds &&
    Array.isArray(object.elements) &&
    object.source &&
    typeof object.source === "object"
  ) {
    const source = object.source as Record<string, unknown>;
    return {
      ...object,
      source: {
        kind: source.kind,
        label: "Captured campus source",
        ...(typeof source.attribution === "string"
          ? { attribution: source.attribution }
          : {}),
        ...(typeof source.image_asset_id === "string"
          ? { image_asset_id: source.image_asset_id }
          : {}),
        ...(typeof source.generated_at === "string"
          ? { generated_at: source.generated_at }
          : {}),
      },
    };
  }
  return Object.fromEntries(
    Object.entries(object).map(([key, child]) => [
      key,
      capturedProposal(child),
    ]),
  );
}

export function privacySafeCampusSceneRows(
  table: string,
  rows: unknown,
): unknown {
  if (
    ![
      "campus_visual_scenes",
      "campus_scene_revisions",
      "campus_scene_import_runs",
    ].includes(table)
  )
    return rows;
  if (!Array.isArray(rows)) return rows;
  return rows.map((value) => {
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    return {
      ...row,
      ...(table === "campus_visual_scenes"
        ? { draft_document: capturedProposal(row.draft_document) }
        : {}),
      ...(table === "campus_scene_revisions"
        ? { document: capturedProposal(row.document) }
        : {}),
      ...(table === "campus_scene_import_runs"
        ? {
            result: capturedProposal(row.result),
            error_message: row.error_message
              ? "Captured import failed; create a new local proposal."
              : null,
          }
        : {}),
    };
  });
}
