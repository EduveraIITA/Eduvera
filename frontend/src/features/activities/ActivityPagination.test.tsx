import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActivityPagination } from "./ActivityPagination";
afterEach(cleanup);
describe("readable finite activity counts", () => {
  it.each([["plans", "plan"], ["registers", "register"], ["matches", "match"], ["history entries", "history entry"]])("uses a singular %s label for one item", (label, singular) => {
    render(<ActivityPagination page={1} pages={1} total={1} label={label} onPage={vi.fn()} />);
    expect(screen.getByText(`1 ${singular}`)).toBeVisible();
  });
  it("preserves explicit names and bounded navigation", () => {
    render(<ActivityPagination page={2} pages={2} total={5} label="plans" onPage={vi.fn()} />);
    expect(screen.getByText("Page 2 of 2 · 5 plans")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled();
  });
});
