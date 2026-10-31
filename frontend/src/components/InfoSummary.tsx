import type { ComponentPropsWithoutRef } from "react";
import { Info } from "lucide-react";
import "./info-summary.css";

/** Hidden help and explanatory context, not a form, record list or navigation.
 * Keep native details/summary semantics: keyboard interaction and expanded state
 * stay browser-owned, and the visible label remains the accessible name.
 */
export function InfoSummary({ children, className = "", ...props }: ComponentPropsWithoutRef<"summary">) {
  return <summary {...props} className={`thatcampus-info-summary ${className}`.trim()}>
    <span className="thatcampus-info-summary__icon" aria-hidden="true"><Info size={18} focusable="false" /></span>
    <span className="thatcampus-info-summary__label">{children}</span>
  </summary>;
}
