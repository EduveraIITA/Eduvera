import type { NoticePortal, NoticeWorkspaceScope } from "./api";

export interface NoticeWorkspaceContext {
  readonly scope: NoticeWorkspaceScope;
  readonly schoolId: string;
  readonly studentId?: string;
  readonly label: string;
  readonly description?: string | null;
  readonly capabilities: readonly string[];
}

export type NoticeExperienceContext =
  | { readonly kind: "legacy"; readonly portal: NoticePortal; readonly studentId?: string }
  | { readonly kind: "workspace"; readonly workspace: NoticeWorkspaceContext };

export function noticeListPath(context: NoticeExperienceContext): string {
  if (context.kind === "legacy") {
    const query = context.portal === "parent" && context.studentId
      ? `?student_id=${encodeURIComponent(context.studentId)}`
      : "";
    return `/${context.portal}/notices${query}`;
  }
  const query = new URLSearchParams();
  if (context.workspace.scope === "dependent" && context.workspace.studentId) {
    query.set("scope", "dependent");
    query.set("student_id", context.workspace.studentId);
  }
  return `/areas/messages/updates${query.size ? `?${query.toString()}` : ""}`;
}

export function noticeDetailPath(context: NoticeExperienceContext, noticeId: string): string {
  const list = noticeListPath(context);
  const [pathname, search = ""] = list.split("?");
  return `${pathname}/${encodeURIComponent(noticeId)}${search ? `?${search}` : ""}`;
}

export function canComposeNotice(context: NoticeExperienceContext): boolean {
  return context.kind === "workspace"
    ? context.workspace.scope === "responsibility" && context.workspace.capabilities.includes("messages.send")
    : context.portal !== "parent";
}
