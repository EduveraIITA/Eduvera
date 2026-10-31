import type { useResourceCommand } from "./useResourceCommand";

export function ResourceWriteFeedback({write,onReview}: {write:ReturnType<typeof useResourceCommand>;onReview?:()=>void}) {
  return <>{write.error ? <p role="alert" className="resource-error">{write.error}</p> : null}
    {write.recovery ? <div className="resource-write-state"><p className="resource-caption">{write.recovery==="accepted" ? "The action is saved. Only the updated view is waiting." : "No new action will be sent while this result is uncertain."}</p><button type="button" className="is-secondary" disabled={write.busy} onClick={()=>void write.recover()}>{write.busy ? "Checking…" : write.recovery==="accepted" ? "Refresh saved record" : write.retrySafe ? "Retry same action" : "Check result"}</button></div> : null}
    {write.obsolete && onReview ? <button type="button" className="is-secondary" disabled={write.busy} onClick={onReview}>Review current record</button> : null}
  </>;
}
