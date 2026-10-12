import type { ReactNode } from "react";
import { OperationsShell } from "../../pages/operations/OperationsShell";
import { ParentShell } from "../../pages/parent/ParentShell";
import type { NoticePortal } from "./api";

export function NoticeShell({ portal, title, backTo, studentId, trailing, children }: {
  portal: NoticePortal; title: string; backTo: string; studentId?: string; trailing?: ReactNode; children: ReactNode;
}) {
  if (portal === "parent") {
    return <ParentShell active="more" pageLabel={title} backTo={backTo} selectedChildId={studentId} pageTitleTrailing={trailing}>{children}</ParentShell>;
  }
  return <OperationsShell portal={portal} active="more" title={title} backTo={backTo} pageTitleTrailing={trailing}>{children}</OperationsShell>;
}
