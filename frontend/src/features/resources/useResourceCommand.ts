import { useEffect, useRef, useState } from "react";
import { ApiError } from "../../lib/api";
import { useUnsavedChangesGuard } from "../navigation/useUnsavedChangesGuard";
import { confirmResourceCommand } from "./resourceApi";

interface ResourceWriteIdentity { loanId: string; expectedRevision: number }
function obsoleteProof(error:unknown,commandId:string,identity:ResourceWriteIdentity|undefined) {
  if(!(error instanceof ApiError) || error.status!==409 || !identity)return false;
  const envelope=error.details as {error?:{code?:unknown;fields?:{resource_loan_obsolete?:Record<string,unknown>}}};
  const proof=envelope?.error?.fields?.resource_loan_obsolete;
  return envelope?.error?.code==="resource_loan_obsolete" && proof?.confirmation==="permanently_inapplicable" && proof.receipt_state==="absent" && proof.reason==="stream_advanced"
    && proof.loan_id===identity.loanId && proof.command_id===commandId && proof.expected_revision===identity.expectedRevision
    && typeof proof.current_revision==="number" && Number.isInteger(proof.current_revision) && proof.current_revision>identity.expectedRevision;
}

/** Source-bound receipts, not a failed refresh, determine whether a new action is safe. */
export function useResourceCommand({schoolId,loanId,kind="loan",refresh,onAccepted}: {
  schoolId:string;loanId?:string;kind?:"loan"|"item";refresh:()=>Promise<unknown>;onAccepted:(sourceId:string)=>void;
}) {
  const active=useRef(true),pending=useRef(false),commandId=useRef(crypto.randomUUID()),saved=useRef(false);
  const retained=useRef<{operation:(id:string)=>Promise<unknown>;identity?:ResourceWriteIdentity}|null>(null);
  const [busy,setBusy]=useState(false),[recovery,setRecovery]=useState<"unknown"|"accepted"|null>(null);
  const [retrySafe,setRetrySafe]=useState(false),[obsolete,setObsolete]=useState(false),[error,setError]=useState("");
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useUnsavedChangesGuard(busy || Boolean(recovery),"This resource action is not confirmed. Stay here to check its result.");
  const finish=async()=>{await refresh();if(active.current)onAccepted(loanId ?? commandId.current);};
  const perform=async()=>{
    if(pending.current || !active.current || !retained.current)return;
    pending.current=true;setBusy(true);setError("");setRetrySafe(false);
    try {
      if(!saved.current){await retained.current.operation(commandId.current);saved.current=true;}
      if(active.current){setRecovery("accepted");await finish();}
    } catch(cause) {
      if(!active.current)return;
      if(!saved.current && obsoleteProof(cause,commandId.current,retained.current.identity)) {
        retained.current=null;setRecovery(null);setObsolete(true);setError("This loan changed. Your entries are kept. Review the current record before sending again.");return;
      }
      // Both owning handlers emit 422 only after checking the exact retained command.
      // It is a definitive refusal even when an earlier response was lost.
      const refused=cause instanceof ApiError && cause.status===422;
      const uncertain=saved.current || (!refused && Boolean(recovery)) || !(cause instanceof ApiError) || cause.status===409 || cause.status>=500 || cause.status<400;
      setRecovery(saved.current ? "accepted" : uncertain ? "unknown" : null);
      setRetrySafe(uncertain && kind==="item");
      setError(saved.current ? "Saved. The updated view could not be loaded. Refresh the saved record."
        : `${cause instanceof Error ? cause.message : "The action was not confirmed."}${uncertain ? " Your choices are locked until the result is checked." : ""}`);
      if(!uncertain){retained.current=null;commandId.current=crypto.randomUUID();}
    } finally {pending.current=false;if(active.current)setBusy(false);}
  };
  const check=async()=>{
    if(pending.current || !active.current)return;pending.current=true;setBusy(true);setError("");
    try {
      if(saved.current){await finish();return;}
      const receipt=await confirmResourceCommand(schoolId,loanId ?? commandId.current,commandId.current);
      if(!active.current)return;
      if(receipt.state==="accepted") {
        if(receipt.result?.id!==(loanId ?? commandId.current))throw new Error("The confirmation belongs to a different record. Keep this action and check again.");
        saved.current=true;setRecovery("accepted");await finish();
      } else if(receipt.state==="not_found") {setRetrySafe(true);setError("No accepted result was found. Retry the same action; its details stay unchanged.");}
      else if(receipt.state==="not_accepted") {retained.current=null;setRecovery(null);setObsolete(true);setError("This action was not accepted. Review the current record before sending again.");}
      else setError("This action is still being checked. Check again shortly.");
    } catch(cause){if(active.current)setError(cause instanceof Error ? cause.message : "The result could not be checked.");}
    finally{pending.current=false;if(active.current)setBusy(false);}
  };
  return {busy,recovery,retrySafe,obsolete,error,locked:busy || Boolean(recovery) || obsolete,
    execute:(operation:(id:string)=>Promise<unknown>,identity?:ResourceWriteIdentity)=>{
      if(pending.current || retained.current || obsolete)return Promise.resolve();retained.current={operation,identity};return perform();
    },
    recover:()=>saved.current ? check() : retrySafe && retained.current ? perform() : check(),
    clearObsolete:()=>{if(pending.current || !obsolete)return;setObsolete(false);setError("");commandId.current=crypto.randomUUID();},
  };
}
