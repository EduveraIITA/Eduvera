import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SceneNumberInput } from "./SceneNumberInput";

afterEach(cleanup);
describe("campus geometry number editing", () => {
  it("allows replacing a value and entering a decimal before committing", async () => {
    const onCommit = vi.fn();
    render(<label>Width<SceneNumberInput value={25} min={.1} max={100} onCommit={onCommit} /></label>);
    const input = screen.getByRole("spinbutton", { name: "Width" });
    await userEvent.clear(input); await userEvent.type(input, "12.5");
    expect(input).toHaveValue(12.5); expect(onCommit).not.toHaveBeenCalled();
    await userEvent.tab(); expect(onCommit).toHaveBeenCalledExactlyOnceWith(12.5);
  });
  it("bounds committed numbers while allowing Escape or empty input to retain the original", async () => {
    const onCommit = vi.fn();
    render(<label>Width<SceneNumberInput value={25} min={.1} max={100} onCommit={onCommit} /></label>);
    const input = screen.getByRole("spinbutton", { name: "Width" });
    await userEvent.clear(input); await userEvent.type(input, "999{Enter}");
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(100);
    onCommit.mockClear();
    await userEvent.clear(input); await userEvent.type(input, "60{Escape}");
    expect(input).toHaveValue(25); expect(onCommit).not.toHaveBeenCalled();
    await userEvent.clear(input); await userEvent.tab();
    expect(input).toHaveValue(25); expect(onCommit).not.toHaveBeenCalled();
  });
});
