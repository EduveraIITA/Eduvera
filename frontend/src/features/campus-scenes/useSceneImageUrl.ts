import { useEffect, useState } from "react";
import { getCampusSceneImage } from "./api";

/** Private source images never become public URLs or survive a world/campus change. */
export function useSceneImageUrl(schoolId: string, campusId: string, imageId: string | undefined, worldKey: string) {
  const [loaded, setLoaded] = useState<{ key: string; url?: string; error?: string } | null>(null);
  const key = `${worldKey}:${schoolId}:${campusId}:${imageId ?? ""}`;
  useEffect(() => {
    if (!imageId) return;
    const controller = new AbortController(); let objectUrl: string | undefined;
    void getCampusSceneImage(schoolId, campusId, imageId, controller.signal).then(blob => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ key, url: objectUrl });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoaded({ key, error: error instanceof Error ? error.message : "The source image could not be loaded. Your editable layout is still available." });
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [schoolId, campusId, imageId, key]);
  return loaded?.key === key ? { url: loaded.url, error: loaded.error, loading: false } : { url: undefined, error: undefined, loading: Boolean(imageId) };
}
