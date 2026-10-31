import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { PeopleNamesComposer } from "./PeopleNamesComposer";
afterEach(cleanup);
function Harness({ initialNames = [], initialDraft = "", disabled = false }: { initialNames?: string[]; initialDraft?: string; disabled?: boolean }) {
  const [names, setNames] = useState(initialNames); const [draft, setDraft] = useState(initialDraft);
  return <PeopleNamesComposer names={names} draft={draft} onNames={setNames} onDraft={setDraft} disabled={disabled} />;
}
describe("names within one accessible composer", () => {
  it("recognizes Enter without splitting full names by spaces, commas or apostrophes", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Name" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "O'Connor, Jo{Enter}Unfinished Person");
    expect(screen.getByRole("button", { name: "Edit O'Connor, Jo" })).toBeVisible();
    expect(input).toHaveValue("Unfinished Person");
    expect(screen.getAllByRole("button", { name: /^Edit/ })).toHaveLength(1);
    expect(input).toHaveFocus();
  });
  it("turns multiline paste into distinct name chips while retaining internal spaces and duplicate names", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.paste(input, { clipboardData: { getData: () => "李 明\r\nAarav  Sharma\nAarav  Sharma" } });
    expect(screen.getByRole("button", { name: "Edit 李 明" })).toBeVisible();
    const repeated = screen.getAllByRole("button", { name: "Edit Aarav Sharma" });
    expect(repeated).toHaveLength(2);
    expect(repeated[0]).toHaveAttribute("aria-label", "Edit Aarav  Sharma");
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
  });
  it("edits chips, supports Escape recovery and removes by keyboard without losing unfinished text", async () => {
    render(<Harness initialNames={["Original Name"]} initialDraft="Draft Name" />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Original Name" }));
    let edit = screen.getByRole("textbox", { name: "Edit name 1" });
    await userEvent.clear(edit); await userEvent.type(edit, "Changed Name{Enter}");
    expect(screen.getByRole("button", { name: "Edit Changed Name" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Draft Name");
    await userEvent.click(screen.getByRole("button", { name: "Edit Changed Name" }));
    edit = screen.getByRole("textbox", { name: "Edit name 1" });
    await userEvent.clear(edit); await userEvent.type(edit, "Temporary{Escape}");
    expect(screen.getByRole("button", { name: "Edit Changed Name" })).toBeVisible();
    screen.getByRole("button", { name: "Remove Changed Name" }).focus();
    await userEvent.keyboard("[Space]");
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Draft Name");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus();
  });
  it("does not recognize an IME Enter until composition has finished", () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "李 明" } });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229, isComposing: true });
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(input).toHaveValue("李 明");
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Edit 李 明" })).toBeVisible();
  });
  it("rejects oversized custom paste before tokenization and keeps previous chips and draft", () => {
    render(<Harness initialNames={["Existing Name"]} initialDraft="Unfinished Name" />);
    const input = screen.getByRole("textbox", { name: "Name" });
    fireEvent.paste(input, { clipboardData: { getData: () => `${"A".repeat(1024 * 1024 + 1)}\nAnother Name` } });
    expect(screen.getByRole("alert")).toHaveTextContent("1 MiB");
    expect(screen.getAllByRole("button", { name: /^Edit/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Edit Existing Name" })).toBeVisible();
    expect(input).toHaveValue("Unfinished Name");
  });
  it("locks native editing and chip controls while an addition is pending", () => {
    render(<Harness initialNames={["Existing Name"]} disabled />);
    expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit Existing Name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove Existing Name" })).toBeDisabled();
  });
  it("keeps the entry textarea visible by scrolling only its own field when a chip is added", async () => {
    render(<Harness />);
    const input = screen.getByRole("textbox", { name: "Name" });
    const field = input.closest<HTMLElement>(".people-names-composer__field")!;
    Object.defineProperty(field, "scrollHeight", { configurable: true, value: 500 });
    field.scrollTop = 0;
    await userEvent.type(input, "Another Person{Enter}");
    expect(field.scrollTop).toBe(500);
    expect(input).toHaveFocus();
  });
});
