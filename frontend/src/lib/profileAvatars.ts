export function profileAvatar(serverAvatar?: string | null): string | undefined {
  const recordedAvatar = serverAvatar?.trim();
  return recordedAvatar || undefined;
}
