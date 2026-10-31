import { useState } from "react";
import type { DiningService } from "./diningApi";
import { DiningPlanDialog } from "./DiningPlanDialog";
import { DiningSessionDialog } from "./DiningSessionDialog";
import { initialDiningMenu, type DiningMenuDraft } from "./diningWeekly";

export function DiningMenuComposer({ service, timezone, onPlanSaved, ...props }: {
  schoolId: string; actorId: string; service: DiningService; timezone: string; refresh: () => Promise<unknown>;
  onClose: () => void; onSaved: (id: string) => void; onPlanSaved: (id: string) => void;
}) {
  const [mode, setMode] = useState<"once" | "weekly">("once"), [draft, setDraft] = useState<DiningMenuDraft>(() => initialDiningMenu(service, timezone));
  return mode === "once" ? <DiningSessionDialog {...props} service={service} timezone={timezone} draft={draft} {...(service.allowed_actions.includes("create_plan") ? { onWeekly: (value: DiningMenuDraft) => { setDraft(value); setMode("weekly"); } } : {})} />
    : <DiningPlanDialog {...props} service={service} timezone={timezone} draft={draft} onSaved={onPlanSaved} onOnce={value => { setDraft(value); setMode("once"); }} />;
}
