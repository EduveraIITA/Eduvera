import { forwardRef, type InputHTMLAttributes } from "react";
import "./temporal-input.css";

export type TemporalInputType = "date" | "time" | "datetime-local" | "month" | "week";

export type TemporalInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  type: TemporalInputType;
};

/**
 * Native date and time input with one responsive sizing contract.
 *
 * The input type keeps the platform picker, keyboard and locale behavior. The
 * shared class removes iOS WebKit's menu-list paint so it cannot override the
 * field's border-box sizing after the CSS cascade.
 */
export const TemporalInput = forwardRef<HTMLInputElement, TemporalInputProps>(
  ({ className, type, ...props }, ref) => (
    <input
      {...props}
      ref={ref}
      type={type}
      className={["temporal-input", className].filter(Boolean).join(" ")}
    />
  ),
);

TemporalInput.displayName = "TemporalInput";
