import { BookOpenCheck, FileCheck2, ShieldCheck } from "lucide-react";

export function MarksheetDocumentHeader({ kind }: { kind: "term" | "assessment" }) {
  const Icon = kind === "term" ? FileCheck2 : BookOpenCheck;

  return <header className="marksheet__document-header">
    <span className="marksheet__document-type"><Icon size={20} aria-hidden="true" /><strong>{kind === "term" ? "Term report" : "Assessment report"}</strong></span>
    <span className="marksheet__status-badge"><ShieldCheck size={15} aria-hidden="true" />Published</span>
  </header>;
}
