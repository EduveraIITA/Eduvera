import { Info } from "lucide-react";
import "./attention.css";

export function AttentionTargetUnavailable({message="This update no longer matches the current record. It was not marked as opened."}:{message?:string}) {
  return <p className="attention-target-status" role="status"><Info size={17}/><span>{message}</span></p>;
}
