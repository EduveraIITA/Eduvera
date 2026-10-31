import { forwardRef, useRef, type ChangeEvent, type InputHTMLAttributes, type SyntheticEvent } from "react";
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
  ({ className, type, onChange, onInput, ...props }, ref) => {
    const deliveredEvents = useRef(new WeakSet<Event>());
    const notifyChange = (event: SyntheticEvent<HTMLInputElement>) => {
      if (deliveredEvents.current.has(event.nativeEvent)) return;
      deliveredEvents.current.add(event.nativeEvent);
      onChange?.(event as ChangeEvent<HTMLInputElement>);
    };
    return <input
      {...props}
      ref={ref}
      type={type}
      className={["temporal-input", className].filter(Boolean).join(" ")}
      onInput={(event) => {
        onInput?.(event);
        // WebKit's native temporal controls can emit input without the change
        // event React expects. Commit that edit to controlled form state too.
        notifyChange(event);
      }}
      onChange={notifyChange}
    />;
  },
);

TemporalInput.displayName = "TemporalInput";
