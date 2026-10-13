import { createRef } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
