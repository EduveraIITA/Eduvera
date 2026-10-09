import { useCallback, useEffect, useRef, useState } from "react";
import { sendTripLocation } from "./api";

type WakeLock = { release: () => Promise<void> };
export function useJourneyTracking(tripId: string | undefined, active: boolean, onSample: () => void, interval = 10) {
  const [status, setStatus] = useState<"paused" | "starting" | "sharing" | "unavailable">("paused");
  const [message, setMessage] = useState("");
  const [trackingTripId,setTrackingTripId]=useState<string>();
  const session = useRef(0);
  const watch = useRef<number | null>(null);
  const wake = useRef<WakeLock | null>(null);
  // Explicit pause and device errors need a retry, not another permission prompt
  // on every poll, visibility change or temporary query error.
  const suspendedTrip = useRef<string | undefined>(undefined);
  const notify = useRef(onSample);
  useEffect(() => { notify.current = onSample; }, [onSample]);
  const clear = useCallback(() => {
    session.current += 1;
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    void wake.current?.release().catch(() => undefined);
    wake.current = null;
  }, []);
  const stop = useCallback(() => { suspendedTrip.current = tripId; clear(); setStatus("paused"); setMessage("Location sharing paused."); }, [tripId, clear]);
  const start = useCallback(async () => {
    if (!tripId || !active || document.hidden) return;
    suspendedTrip.current = undefined;
    clear(); const current = session.current;
    setTrackingTripId(tripId);
    if (!navigator.geolocation) { suspendedTrip.current = tripId; setStatus("unavailable"); setMessage("Location is unavailable on this device. Rider recording still works."); return; }
    setStatus("starting"); setMessage("Finding your location…");
    let lastAttempt = 0; let sending = false;
    watch.current = navigator.geolocation.watchPosition(position => {
      if (current !== session.current || sending || Date.now() - lastAttempt < interval * 1000) return;
      sending = true; lastAttempt = Date.now();
      void sendTripLocation(tripId, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy_metres: position.coords.accuracy,
        heading_degrees: Number.isFinite(position.coords.heading) ? position.coords.heading : null,
        speed_metres_per_second: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
        observed_at: new Date(position.timestamp).toISOString() }).then(result => {
          if (current !== session.current) return;
          if (result.accepted) { setStatus("sharing"); setMessage("Location sharing is on."); notify.current(); }
          else { setStatus("starting"); setMessage("Waiting for the next fresh location sample…"); }
        }).catch(error => {
          if (current !== session.current) return;
          setStatus("unavailable"); setMessage(error instanceof Error ? error.message : "Location was not sent. Check your connection; rider recording remains separate.");
        }).finally(() => { sending = false; });
    }, error => {
      if (current !== session.current) return;
      suspendedTrip.current = tripId; clear(); setStatus("unavailable");
      setMessage(error.code === 1 ? "Location permission was denied. Enable it in browser settings and try again." : "Location is unavailable. Try again in a clearer area.");
    }, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
    try {
      const api = navigator as Navigator & { wakeLock?: { request: (kind: "screen") => Promise<WakeLock> } };
      const lock = await api.wakeLock?.request("screen");
      if (current === session.current) wake.current = lock ?? null;
      else await lock?.release();
    } catch { /* Foreground tracking still works without a wake lock. */ }
  }, [tripId, active, interval, clear]);
  useEffect(() => {
    let disposed = false;
    const resume = () => {
      if (!disposed && active && tripId && !document.hidden && suspendedTrip.current !== tripId) void start();
    };
    const visibilityChanged = () => {
      if (document.hidden) {
        clear();
        if (active && tripId && suspendedTrip.current !== tripId) {
          setStatus("paused"); setMessage("Location resumes when you return to this screen.");
        }
      } else resume();
    };
    // Defer startup so StrictMode's discarded mount cannot request permission
    // or install a second location watcher.
    queueMicrotask(resume);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => { disposed = true; clear(); document.removeEventListener("visibilitychange", visibilityChanged); };
  }, [tripId, active, clear, start]);
  const current=active&&tripId===trackingTripId;
  return { status:current?status:"paused", message:current?message:"", start, stop, running: current&&(status === "starting" || status === "sharing") };
}
