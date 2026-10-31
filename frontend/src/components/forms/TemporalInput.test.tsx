import { createRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporalInput } from "./TemporalInput";

afterEach(cleanup);

describe("TemporalInput", () => {
  it("preserves native picker attributes and composes its bounded class", () => {
    const ref = createRef<HTMLInputElement>();
    render(<label>Starts on<TemporalInput ref={ref} className="custom-control" type="date" name="starts_on" min="2026-10-01" max="2026-10-31" defaultValue="2026-10-13" required /></label>);
    const input = screen.getByLabelText("Starts on");
    expect(input).toHaveAttribute("type", "date");
    expect(input).toHaveAttribute("min", "2026-10-01");
    expect(input).toHaveAttribute("max", "2026-10-31");
    expect(input).toHaveClass("temporal-input", "custom-control");
    expect(ref.current).toBe(input);
  });

  it("supports native date-time values without changing their submitted form value", () => {
    render(<label>Observed at<TemporalInput type="datetime-local" name="observed_at" value="2026-10-13T11:30" readOnly /></label>);
    expect(screen.getByLabelText("Observed at")).toHaveValue("2026-10-13T11:30");
  });

  it.each([
    ["time", "09:00", "10:00"],
    ["datetime-local", "2026-10-20T09:00", "2026-10-20T10:00"],
  ] as const)("commits native %s input edits to controlled form state", (type, initial, edited) => {
    const changed = vi.fn();
    const inputted = vi.fn();
    function Form() {
      const [value, setValue] = useState(initial as string);
      return <><label>When<TemporalInput type={type} value={value} onInput={inputted} onChange={(event) => {
        changed(event.target.value);
        setValue(event.target.value);
      }} /></label><output aria-label="Saved form value">{value}</output></>;
    }
    render(<Form />);

    fireEvent.input(screen.getByLabelText("When"), { target: { value: edited } });

    expect(screen.getByLabelText("Saved form value")).toHaveTextContent(edited);
    expect(changed).toHaveBeenCalledExactlyOnceWith(edited);
    expect(inputted).toHaveBeenCalledTimes(1);
  });
});
