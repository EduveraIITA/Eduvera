/** Native file access retains the existing app-private filesystem rules. */
export function pendingFileUriAllowed(uri: string, _scopeKey: string, _allowPicked = false) { return uri.startsWith('file://'); }
export function leaveFileUriAllowed(uri: string, _scopeKey: string) { return uri.startsWith('file://') && uri.includes('/thatcampus-leave-pending/'); }
