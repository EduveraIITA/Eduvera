export function principalRegisterHistoryQueryKey(
  sessionId: string | null,
  classSectionId: string | null,
  date: string,
) {
  return [
    "principal-register-history",
    sessionId ? "session" : "daily",
    sessionId ?? classSectionId,
    date,
  ] as const;
}
