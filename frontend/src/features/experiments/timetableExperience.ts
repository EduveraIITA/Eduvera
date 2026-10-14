import { useSyncExternalStore } from "react";

export type TimetableExperience = "current" | "timeline";

const eventName = "thatcampus:timetable-experience-change";
const keyFor = (userId: string) => `thatcampus:experiments:timetable:${userId}`;

export function readTimetableExperience(userId: string): TimetableExperience {
  try {
    return window.localStorage.getItem(keyFor(userId)) === "timeline" ? "timeline" : "current";
  } catch {
    return "current";
  }
}

export function setTimetableExperience(userId: string, experience: TimetableExperience) {
  try {
    window.localStorage.setItem(keyFor(userId), experience);
  } catch {
    // Private browsing may deny storage. The current view remains the safe default.
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: { userId, experience } }));
}

function subscribe(userId: string, callback: () => void) {
  const onPreference = (event: Event) => {
    if ((event as CustomEvent<{ userId?: string }>).detail?.userId === userId) callback();
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === keyFor(userId)) callback();
  };
  window.addEventListener(eventName, onPreference);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(eventName, onPreference);
    window.removeEventListener("storage", onStorage);
  };
}

export function useTimetableExperience(userId: string) {
  return useSyncExternalStore(
    (callback) => subscribe(userId, callback),
    () => readTimetableExperience(userId),
    () => "current",
  );
}
