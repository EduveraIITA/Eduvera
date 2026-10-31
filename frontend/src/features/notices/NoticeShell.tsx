import type { ReactNode } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import type { NoticeExperienceContext } from "./noticeWorkspaceContext";

export function NoticeShell({ context, title, backTo, studentId, trailing, children }: {
  context: NoticeExperienceContext; title: string; backTo: string; studentId?: string; trailing?: ReactNode; children: ReactNode;
}) {
  if (context.kind === "workspace") {
    return <OperationsShell active="areas" title={title} backTo={backTo} pageTitleTrailing={trailing}>{children}</OperationsShell>;
  }
  if (context.portal === "parent") {
    return <ParentShell active="more" pageLabel={title} backTo={backTo} selectedChildId={studentId} pageTitleTrailing={trailing}>{children}</ParentShell>;
  }
  return <OperationsShell portal={context.portal} active="more" title={title} backTo={backTo} pageTitleTrailing={trailing}>{children}</OperationsShell>;
}
