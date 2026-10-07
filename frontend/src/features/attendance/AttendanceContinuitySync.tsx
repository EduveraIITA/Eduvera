import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { saveAttendanceContinuityBatch } from "../operations/api";
import { useAuth } from "../auth/AuthContext";
import { listQueuedAttendanceCaptures, removeQueuedAttendanceCapture } from "./attendanceOfflineStore";

export const attendanceContinuityEvent = "omnischool:attendance-continuity";

export function AttendanceContinuitySync() {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const syncing = useRef(false);

  useEffect(() => {
    const sync = async () => {
      if (!navigator.onLine || syncing.current || !auth.user) return;
      syncing.current = true;
      try {
        const captures = await listQueuedAttendanceCaptures(auth.user.id);
        for (const capture of captures) {
          try {
            const result = await saveAttendanceContinuityBatch(capture.classSectionId, capture.date, capture.input);
            if (["accepted", "quarantined", "rejected"].includes(result.status)) {
              await removeQueuedAttendanceCapture(auth.user.id, capture.classSectionId, capture.date);
              window.dispatchEvent(new CustomEvent(attendanceContinuityEvent, {
                detail: { classSectionId: capture.classSectionId, date: capture.date, status: result.status },
              }));
            }
          } catch {
            // A network/server interruption keeps the encrypted capture on this device.
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["teacher-attendance"] }),
          queryClient.invalidateQueries({ queryKey: ["principal-register"] }),
          queryClient.invalidateQueries({ queryKey: ["teacher-home"] }),
          queryClient.invalidateQueries({ queryKey: ["principal-home"] }),
          queryClient.invalidateQueries({ queryKey: ["attendance-continuity"] }),
        ]);
      } catch {
        // Unsupported storage is surfaced inside the attendance register itself.
      } finally {
        syncing.current = false;
      }
    };
    const requestSync = () => { void sync(); };
    const interval = window.setInterval(() => void sync(), 30_000);
    window.addEventListener("online", requestSync);
    void sync();
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", requestSync);
    };
  }, [auth.user, queryClient]);

  return null;
}
