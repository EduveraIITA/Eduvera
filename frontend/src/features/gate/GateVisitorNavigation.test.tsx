import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { VisitorCounts, VisitorPagination } from "./api";
import { GateVisitorFilters, GateVisitorPagination, visitorFilterFromUrl, visitorPageFromUrl } from "./GateVisitorNavigation";
import { GateVisitors } from "./GateVisitors";

afterEach(cleanup);
const counts: VisitorCounts = { all: 101, active: 31, pending: 10, approved: 10, inside: 11, closed: 70 };
const pagination: VisitorPagination = { page: 2, page_size: 25, total: 101, total_pages: 5, has_previous: true, has_next: true, filter: "all" };

it("keeps a finite native pager and supports keyboard navigation", async () => {
  const change = vi.fn();
  render(<GateVisitorPagination pagination={pagination} hindi={false} busy={false} onChange={change} />);
  expect(screen.getByRole("navigation", { name: "Visitor pages" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("Page 2 of 5 · 101 visitors");
  const user = userEvent.setup();
  await user.tab();expect(screen.getByRole("button", { name: "Previous" })).toHaveFocus();
  await user.keyboard("{Enter}");expect(change).toHaveBeenLastCalledWith(1);
  await user.tab();await user.keyboard("{Enter}");expect(change).toHaveBeenLastCalledWith(3);
});

it("uses server totals and requests a server filter rather than filtering a truncated page", async () => {
  const filter = vi.fn();
  render(<GateVisitors visitors={[{ id: "closed", name: "Page visitor", purpose: "Delivery", school_id: "school", state: "out", revision: 2 }]} counts={counts} pagination={pagination} hindi={false} busy={false} onMove={vi.fn()} onFilterChange={filter} onPageChange={vi.fn()} />);
  expect(screen.getByRole("option", { name: "Inside · 11" })).toBeVisible();
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Filter visitors" }), "inside");
  expect(filter).toHaveBeenCalledWith("inside");
  expect(screen.getByRole("heading", { name: "Page visitor" })).toBeVisible();
});

it("disables page boundaries and all controls while a command is saving", () => {
  const view = render(<GateVisitorPagination pagination={{ ...pagination, page: 1, has_previous: false }} hindi={false} busy={false} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  view.rerender(<GateVisitorPagination pagination={{ ...pagination, page: 5, has_next: false }} hindi={false} busy onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
});

it("retains Hindi controls and has no misleading pager for an empty result", () => {
  const view = render(<><GateVisitorFilters filter="inside" counts={counts} hindi busy onChange={vi.fn()} /><GateVisitorPagination pagination={pagination} hindi busy={false} onChange={vi.fn()} /></>);
  expect(screen.getByRole("combobox", { name: "आगंतुक फ़िल्टर" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "अगला" })).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent("पृष्ठ 2 / 5 · 101 आगंतुक");
  view.rerender(<GateVisitorPagination pagination={{ ...pagination, total: 0, total_pages: 0 }} hindi={false} busy={false} onChange={vi.fn()} />);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});

it("normalizes invalid URL choices without manufacturing an extra page", () => {
  expect(visitorFilterFromUrl("inside")).toBe("inside");
  expect(visitorFilterFromUrl("anything")).toBe("all");
  expect(visitorPageFromUrl("2")).toBe(2);
  for (const value of [null, "-1", "0", "2junk", "1.5", "9007199254740992"]) expect(visitorPageFromUrl(value)).toBe(1);
});
