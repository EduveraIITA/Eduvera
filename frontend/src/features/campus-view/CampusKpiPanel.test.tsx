import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CampusKpiTimeSeries } from "./CampusKpiCharts";
import { CampusKpiPanel } from "./CampusKpiPanel";
import { getCampusKpis } from "./kpiApi";
import type { CampusKpiPage, CampusKpiRange, CampusKpiResponse } from "./kpiApi";

vi.mock("./kpiApi", () => ({ getCampusKpis: vi.fn() }));
const getCampusKpisMock = vi.mocked(getCampusKpis);

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); };
});

function fixture(page: CampusKpiPage = "overview", range: CampusKpiRange = "today"): CampusKpiResponse {
  const metric = {
    key: "register_completion",
    label: "Teaching register completion",
    description: "Registers completed for scheduled teaching sessions.",
    unit: "percent" as const,
    value: 75,
    numerator: 6,
    denominator: 8,
    unknown_count: 0,
    availability: "available" as const,
    scope: "selected_campus" as const,
    evidence_dimensions: ["expected", "accepted"] as const,
    source_label: "Attendance registers",
    source_max_at: "2026-10-17T03:58:00.000Z",
    unavailable_reason: null,
    target_path: "/principal/attendance",
    series: [
      { bucket_start: "2026-10-17T03:30:00.000Z", bucket_end: "2026-10-17T03:45:00.000Z", value: 50, numerator: 4, denominator: 8, unknown_count: 0 },
      { bucket_start: "2026-10-17T03:45:00.000Z", bucket_end: "2026-10-17T04:00:00.000Z", value: 75, numerator: 6, denominator: 8, unknown_count: 0 },
    ],
  };
  const gateMetric = (direction: "entries" | "exits", values: [number, number]) => ({
    key: `access.gate_${direction}_recorded`,
    label: `Recorded gate ${direction}`,
    description: `Accepted ${direction} at configured campus gates.`,
    unit: "count" as const,
    value: values[0] + values[1],
    numerator: values[0] + values[1],
    denominator: null,
    unknown_count: 0,
    availability: "available" as const,
    scope: "selected_campus" as const,
    evidence_dimensions: ["accepted"] as const,
    source_label: "Accepted gate observations",
    source_max_at: "2026-10-17T03:58:00.000Z",
    unavailable_reason: null,
    series: [
      { bucket_start: "2026-10-17T03:30:00.000Z", bucket_end: "2026-10-17T03:45:00.000Z", value: values[0], numerator: values[0], denominator: null, unknown_count: 0 },
      { bucket_start: "2026-10-17T03:45:00.000Z", bucket_end: "2026-10-17T04:00:00.000Z", value: values[1], numerator: values[1], denominator: null, unknown_count: 0 },
    ],
  });
  return {
    schema_version: 1,
    page,
    range,
    generated_at: "2026-10-17T04:00:00.000Z",
    period: { from: "2026-10-17T00:00:00.000Z", to: "2026-10-17T23:59:59.999Z", timezone: "Asia/Kolkata" },
    bucket: { kind: range === "today" ? "15_minute" : range === "7d" || range === "30d" ? "hour" : "day", label: range === "today" ? "15-minute" : range === "7d" || range === "30d" ? "Hourly" : "Daily" },
    scope: { campus_id: "campus-1", campus_label: "Main campus" },
    metrics: page === "overview" ? [metric, gateMetric("entries", [2, 3]), gateMetric("exits", [1, 1])] : [metric],
    overview: page === "overview" ? {
      headline_keys: [metric.key],
      headlines: [
        {
          key: metric.key,
          label: metric.label,
          value: metric.value,
          unit: metric.unit,
          availability: metric.availability,
          value_context: "selected_period",
        },
        {
          key: "coordination.work_open",
          label: "Open actionable work",
          value: 5,
          unit: "count",
          availability: "available",
          value_context: "current_at_as_of",
          secondary: {
            key: "coordination.work_overdue",
            label: "Overdue",
            value: 2,
            availability: "available",
          },
        },
      ],
      evidence_state: "available",
      composition: { label: "Current space state", unit: "spaces", slices: [
        { key: "accepted", label: "Accepted", value: 3, tone: "accepted" },
        { key: "expected", label: "Expected only", value: 4, tone: "expected" },
        { key: "unknown", label: "Unknown", value: 1, tone: "unknown" },
      ] },
      bottlenecks: [{
        id: "late-registers",
        label: "Registers awaiting submission",
        detail: "Two scheduled sessions still need a recorded decision.",
        count: 2,
        severity: "review",
        scope: "selected_campus",
        evidence_dimension: "expected",
        source_label: "Published timetable and attendance",
        target_path: "/principal/attendance",
      }],
    } : undefined,
  };
}

function Harness({ rehearsalActive = false }: { rehearsalActive?: boolean }) {
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement | null>(null);
  return <>
    <button type="button" onClick={(event) => {
      setReturnFocus(event.currentTarget);
      setOpen(true);
    }}>Open KPIs</button>
    {open ? <CampusKpiPanel
      schoolId="school-1"
      campusId="campus-1"
      timezone="Asia/Kolkata"
      rehearsalActive={rehearsalActive}
      returnFocus={returnFocus}
      onClose={() => setOpen(false)}
    /> : null}
  </>;
}

function renderHarness(props?: { rehearsalActive?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><Harness {...props} /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  getCampusKpisMock.mockReset();
  getCampusKpisMock.mockImplementation((_schoolId, options) => Promise.resolve(fixture(options.page, options.range)));
});
afterEach(() => cleanup());

describe("CampusKpiPanel", () => {
  it("keeps live evidence separate from isolated planning", async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));
    await screen.findByText("Current space state");

    await user.click(screen.getByRole("button", { name: "Plan & what-if" }));
    expect(await screen.findByRole("heading", { name: "Test a future change" })).toBeInTheDocument();
    expect(screen.getByText(/No live changes or messages/i)).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Live performance" }));
    expect(await screen.findByRole("tab", { name: "Overview" })).toBeInTheDocument();
  });

  it("navigates KPI pages and history ranges without replacing the campus map query", async () => {
    const user = userEvent.setup();
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));

    expect(await screen.findByRole("heading", { name: "Campus performance" })).toBeInTheDocument();
    expect(await screen.findByText(/Today through/i)).toBeInTheDocument();
    expect(screen.queryByText("Right now")).not.toBeInTheDocument();
    expect(await screen.findByText("Current space state")).toBeInTheDocument();
    const openWorkCell = (await screen.findByText("Open actionable work")).closest("li");
    expect(openWorkCell).not.toBeNull();
    expect(within(openWorkCell!).getByText("5")).toBeInTheDocument();
    expect(within(openWorkCell!).getByText("Overdue")).toBeInTheDocument();
    expect(within(openWorkCell!).getByText("2")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Teaching" }));
    expect(await screen.findByText("Teaching register completion")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "7d" }));

    await waitFor(() => expect(getCampusKpisMock).toHaveBeenLastCalledWith(
      "school-1",
      { campusId: "campus-1", page: "teaching", range: "7d" },
      expect.anything(),
    ));
    expect(await screen.findByText("Hourly intervals")).toBeInTheDocument();
  });

  it("provides textual chart summaries, semantic tables and a disclosed rehearsal boundary", async () => {
    const user = userEvent.setup();
    renderHarness({ rehearsalActive: true });
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));

    expect(await screen.findByRole("table", { name: "Current source-backed campus bottlenecks" })).toBeInTheDocument();
    expect(screen.getByText(/rehearsal layer shown on the map is excluded/i)).toBeInTheDocument();
    expect(screen.getByText(/5 entries and 2 exits/i)).toBeInTheDocument();
    expect(screen.getByText(/not current presence/i)).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Teaching" }));
    expect(await screen.findByText(/across 2 recorded 15-minute intervals/i)).toBeInTheDocument();
    expect(screen.getByText(/Newest source timestamp/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open source for Teaching register completion" })).toBeInTheDocument();
    await user.click(screen.getByText("View time-series data"));
    expect(await screen.findByRole("table", { name: "Teaching register completion by 15-minute interval" })).toBeInTheDocument();
  });

  it("shows loading, error and unavailable evidence states without inventing zero", async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    getCampusKpisMock.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRequest = reject; }));
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));
    expect(screen.getByLabelText("Loading campus KPIs")).toBeInTheDocument();
    rejectRequest?.(new Error("offline"));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn’t load campus KPIs");

    getCampusKpisMock.mockImplementation((_schoolId, options) => {
      const response = fixture(options.page, options.range);
      return Promise.resolve(options.page === "teaching" ? {
        ...response,
        metrics: [{
          ...response.metrics[0]!,
          value: null,
          numerator: null,
          denominator: null,
          unknown_count: 3,
          availability: "unavailable" as const,
          unavailable_reason: "No authoritative attendance source is configured for this period.",
          series: [],
        }],
      } : response);
    });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await user.click(screen.getByRole("tab", { name: "Teaching" }));
    expect(await screen.findByText("Not enough evidence")).toBeInTheDocument();
    expect(screen.getByText("No authoritative attendance source is configured for this period.")).toBeInTheDocument();
    expect(screen.getByText("3 source items remain unknown for this measure.")).toBeInTheDocument();
    expect(screen.queryByText(/^0%$/)).not.toBeInTheDocument();
  });

  it("does not turn incomplete evidence into an all-clear bottleneck state", async () => {
    const user = userEvent.setup();
    getCampusKpisMock.mockImplementation((_schoolId, options) => {
      const response = fixture(options.page, options.range);
      const overview = response.overview ? { ...response.overview, evidence_state: "partial" as const, bottlenecks: [] } : undefined;
      return Promise.resolve({
        ...response,
        overview,
        metrics: response.metrics.map((metric, index) => index === 0
          ? { ...metric, availability: "partial" as const, unknown_count: 2 }
          : metric),
      });
    });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));

    expect(await screen.findByText("No bottlenecks recorded")).toBeInTheDocument();
    expect(screen.getByText(/This is not an all-clear/i)).toBeInTheDocument();
    expect(screen.getByText("1 of 3 snapshot measures have incomplete coverage.")).toBeInTheDocument();
  });

  it("falls back to headline keys when additive headline records are absent", async () => {
    const user = userEvent.setup();
    getCampusKpisMock.mockImplementation((_schoolId, options) => {
      const response = fixture(options.page, options.range);
      return Promise.resolve({
        ...response,
        overview: response.overview ? { ...response.overview, headlines: undefined } : undefined,
      });
    });
    renderHarness();
    await user.click(screen.getByRole("button", { name: "Open KPIs" }));

    expect(await screen.findByText("Teaching register completion")).toBeInTheDocument();
    expect(screen.queryByText("Open actionable work")).not.toBeInTheDocument();
  });

  it("restores focus to the KPI trigger when the sheet closes", async () => {
    const user = userEvent.setup();
    renderHarness();
    const trigger = screen.getByRole("button", { name: "Open KPIs" });
    await user.click(trigger);
    await screen.findByRole("heading", { name: "Campus performance" });
    await user.click(screen.getByRole("button", { name: "Close campus performance" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("keeps dense historical series readable while retaining the full data table", async () => {
    const user = userEvent.setup();
    const response = fixture("teaching", "1y");
    const metric = {
      ...response.metrics[0]!,
      series: Array.from({ length: 60 }, (_, index) => ({
        bucket_start: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
        bucket_end: new Date(Date.UTC(2026, 0, index + 2)).toISOString(),
        value: 50 + index % 20,
        numerator: 5 + index % 3,
        denominator: 10,
        unknown_count: index === 12 ? 1 : 0,
      })),
    };
    const { container } = render(<CampusKpiTimeSeries metric={metric} bucket={{ kind: "day", label: "Daily" }} timezone="Asia/Kolkata" />);

    expect(container.querySelectorAll(".campus-kpi-series__point")).toHaveLength(0);
    expect(container.querySelectorAll(".campus-kpi-series__x-tick")).toHaveLength(4);
    await user.click(screen.getByText("View time-series data"));
    expect(await screen.findAllByRole("row")).toHaveLength(61);
    expect(screen.getByRole("columnheader", { name: "Unknown" })).toBeInTheDocument();
  });
});
