import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AnalyticsSummary } from "./AnalyticsSummary";
import { InstitutionSummary } from "./InstitutionAnalytics";
import { AttendanceData } from "./AnalyticsCharts";
import { analyticsFixture } from "../principal-insights/insight-test-fixtures";

const source = (path: string) => readFileSync(join(process.cwd(), "src", path), "utf8");
afterEach(cleanup);

describe("Insights presentation contract", () => {
  it("inherits semantic theme values instead of a legacy portal palette", () => {
    const principal = source("features/principal-insights/principal-insights.css");
    expect(principal).not.toContain("--op-");
    expect(principal).toContain("var(--thatcampus-ink)");
    expect(principal).toContain("var(--thatcampus-border)");
    expect(principal).toMatch(/\.principal-insights__filters select\{[^}]*font-size:16px/);
    const home = source("features/principal-home/principal-home.css");
    expect(home.match(/\.principal-home--focused \.principal-home__snapshot\s*\{([^}]+)\}/)?.[1]).toContain("background:var(--thatcampus-surface-soft)");
    expect(home).not.toContain("color: #fff");
    for (const path of ["features/analytics/analytics.css", "features/principal-insights/principal-insights.css", "features/principal-insights/unified-insights.css", "features/principal-home/principal-home.css"]) {
      expect(source(path)).not.toMatch(/linear-gradient|box-shadow:\s*inset 3px 0|border-left:\s*[3-9]px/);
    }
  });

  it("uses decorative product identities without changing reporting labels or owning destinations", () => {
    render(<MemoryRouter><AnalyticsSummary data={analyticsFixture} audience="principal" search="?scope=institution" /></MemoryRouter>);
    const attendance = screen.getByRole("link", { name: "Explore attendance", exact: true });
    expect(attendance).toHaveAttribute("href", "/areas/insights/attendance?scope=institution");
    expect(attendance.querySelector('[data-product-icon="attendance"]')).toHaveAttribute("aria-hidden", "true");
    expect(within(attendance).getByRole("heading", { name: "Attendance" })).toBeVisible();
    expect(attendance).toHaveTextContent("75%");
    expect(within(attendance).getByRole("figure")).toHaveAccessibleName(/Missing periods are gaps, not zero/);
  });

  it("keeps the textual chart alternative labelled and keyboard reachable", () => {
    render(<AttendanceData attendance={analyticsFixture.attendance!} />);
    const region = screen.getByRole("region", { name: "Attendance trend data" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table", { name: "Attendance trend data" })).toBeVisible();
    expect(within(region).getByRole("columnheader", { name: "Attended / counted" })).toBeVisible();
  });

  it("keeps each institution metric distinct, dated and linked to its owning source", () => {
    render(<MemoryRouter><InstitutionSummary data={analyticsFixture.institution!} to="/areas/insights/institution?scope=institution&period=90" /></MemoryRouter>);
    const snapshot = screen.getByRole("link", { name: "Explore institution snapshot" });
    expect(snapshot).toHaveAttribute("href", "/areas/insights/institution?scope=institution&period=90");
    expect(within(snapshot).getByText("Current records · 8 Oct")).toBeVisible();
    const metrics = within(snapshot).getByLabelText("Current institution metrics");
    for (const [label, value] of [["Enrolled students", "51"], ["Active staff", "7"], ["Classes with students", "2"], ["Average class size", "25.5"]]) {
      expect(within(metrics).getByText(label).nextElementSibling).toHaveTextContent(value);
    }
    expect(within(snapshot).queryByRole("figure")).not.toBeInTheDocument();
  });

  it("does not turn an unavailable average into a zero metric", () => {
    render(<MemoryRouter><InstitutionSummary data={{ ...analyticsFixture.institution!, average_class_size: null }} to="/areas/insights/institution" /></MemoryRouter>);
    expect(screen.getByText("Average class size").nextElementSibling).toHaveTextContent("—");
  });
});
