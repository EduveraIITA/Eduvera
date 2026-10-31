import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CollectionView } from "./CollectionView";

const records = Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1), name: `Person ${index + 1}`, active: index < 10 }));
function Location() { return <output aria-label="Current URL">{useLocation().search}</output>; }
function show(search = "", focusedId?: string, disabled = false, printAll = false) {
  return render(<MemoryRouter initialEntries={[`/directory?school=campus-1&other_page=3${search}`]}><CollectionView items={records} namespace="people" label="records" searchLabel="Find a record" searchText={(item) => item.name} categoryLabel="Record state" categories={[{ value: "active", label: "Active", matches: (item) => item.active }]} focusedId={focusedId} disabled={disabled} renderAllForPrint={printAll}>{(visible) => <ul>{visible.map((item) => <li key={item.id}>{item.name}</li>)}</ul>}</CollectionView><Location /></MemoryRouter>);
}
afterEach(cleanup);

describe("finite contextual collections", () => {
  it("shows ten records per page and preserves independent URL context", async () => {
    show();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText("Page 1 of 2 · 12 records")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next", exact: true }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("group", { name: "records collection" })).toHaveFocus();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("school=campus-1&other_page=3&people_page=2");
    await userEvent.type(screen.getByRole("searchbox", { name: "Find a record" }), "Person 12");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Person 12")).toBeVisible();
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("people_page");
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("other_page=3");
  });
  it("filters the returned collection by real categories and resets its page", async () => {
    show("&people_page=2");
    expect(screen.getByRole("option", { name: "Active · 10" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Record state" }), "active");
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.queryByText("Person 11")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Current URL")).toHaveTextContent("people_filter=active");
    expect(screen.getByLabelText("Current URL")).not.toHaveTextContent("people_page");
  });
  it("opens an exact target's page once without trapping subsequent navigation", async () => {
    show("&people_search=missing&people_filter=active", "12");
    expect(await screen.findByText("Person 12")).toBeVisible();
    expect(screen.getByText("Page 2 of 2 · 12 records")).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Previous", exact: true }));
    expect(screen.queryByText("Person 12")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2 · 12 records")).toBeVisible();
  });
  it.each(["-1", "not-a-page", "999999999999999999999"])("safely starts at page one for invalid input %s", (page) => {
    show(`&people_page=${page}`);
    expect(screen.getByText("Page 1 of 2 · 12 records")).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
  });
  it("clamps a stale page and prevents paging or filtering during a command", async () => {
    show("&people_page=20", undefined, true);
    expect(screen.getByText("Page 2 of 2 · 12 records")).toBeVisible();
    expect(screen.getByRole("searchbox")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous", exact: true })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous", exact: true }));
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
  it("can render the full statement for printing independently of the screen page and search", () => {
    show("&people_page=2&people_search=Person+12", undefined, false, true);
    expect(within(screen.getByRole("group", { name: "records collection" })).getAllByRole("listitem")).toHaveLength(12);
  });
});
