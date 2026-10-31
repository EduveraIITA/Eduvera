import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentChannelConnections } from "./AgentChannelConnections";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { createSimulationExecutionEnvironment } from "../simulation/executionEnvironment";

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock("../../lib/api", () => ({ apiFetch: apiFetchMock }));

beforeEach(() => {
  apiFetchMock.mockReset();
});
afterEach(cleanup);

it("offers to move a messaging connection when another authorized scope is selected", async () => {
  apiFetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/api/v1/agent/channels" && !init) return Promise.resolve({ providers: [{
      name: "telegram", label: "Telegram", configured: true, username: "@ThatCampusBot",
      connection: { portal: "principal", student_id: null, linked_at: "2026-10-19T00:00:00Z", last_inbound_at: null, last_outbound_at: null },
    }] });
    return Promise.resolve({});
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AgentChannelConnections audience="teacher" /></QueryClientProvider>);

  expect(await screen.findByText("Connected for another authorized scope")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Use this scope" })).toBeEnabled();
});

it("keeps provider administration in Live and makes no channel request from Simulation", () => {
  const environment = createSimulationExecutionEnvironment({
    namespaceId: "scenario:scenario-1:run:run-1",
    scenarioId: "scenario-1",
    runId: "run-1",
    institutionId: "school-1",
    sourceSnapshotAt: "2026-10-19T00:00:00.000Z",
    virtualClock: { now: "2026-10-20T00:00:00.000Z", timeZone: "UTC" },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExecutionEnvironmentProvider environment={environment}>
        <AgentChannelConnections audience="teacher" />
      </ExecutionEnvironmentProvider>
    </QueryClientProvider>,
  );

  expect(screen.getByText("Messaging connections stay in Live")).toBeInTheDocument();
  expect(screen.getByText(/captured as contained evidence in Simulation results/i)).toBeInTheDocument();
  expect(apiFetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /connect|disconnect|use this scope/i })).not.toBeInTheDocument();
});

it("explains degraded providers and uncertain delivery without claiming success",async()=>{
  apiFetchMock.mockResolvedValue({providers:[{name:'telegram',label:'Telegram',configured:true,availability:'temporarily_unavailable',
    connection:{portal:'teacher',student_id:null,uncertain_replies:1}}]});
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  render(<QueryClientProvider client={client}><AgentChannelConnections audience="teacher"/></QueryClientProvider>);
  expect(await screen.findByText(/Temporarily unavailable/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Read it in the ThatCampus assistant');
});
