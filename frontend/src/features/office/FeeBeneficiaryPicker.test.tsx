import { useState, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "../../lib/api";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import { FeeBeneficiaryPicker } from "./FeeBeneficiaryPicker";
import type { FeeAudienceSelection } from "./feeBatchApi";
vi.mock("../../lib/api", async original => ({ ...await original<typeof import("../../lib/api")>(), apiFetch: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "issuer" } }) }));
vi.mock("../planner/PlannerLessonSheet", () => ({ PlannerDialog: ({ title, children }: { title: string; children: ReactNode }) => <section role="dialog" aria-label={title}>{children}</section> }));
const add = vi.fn(), close = vi.fn();
let canAdd = false;
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() { const [selection, setSelection] = useState<FeeAudienceSelection>({ person_ids: [], groups: [] }); return <><FeeBeneficiaryPicker schoolId="school" selection={selection} onChange={setSelection} disabled={false} onAddPeople={add} onClose={close} /><output>{JSON.stringify(selection)}</output></>; }
  render(<QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><Harness /></ExecutionEnvironmentProvider></QueryClientProvider>); return client;
}
beforeEach(() => {
  canAdd = false; vi.mocked(apiFetch).mockImplementation(path => {
    const params = new URL(path, "https://example.test").searchParams;
    return Promise.resolve({ page: Number(params.get("page")), page_size: 25, can_add_people: canAdd, total: params.get("kind") === "groups" ? 2 : 26,
      results: params.get("kind") === "groups" ? [{ kind: "participation", id: "same-id", name: "Robotics", member_count: 1 }, { kind: "learning", id: "same-id", name: "Robotics", member_count: 3 }]
        : params.get("page") === "2" ? [{ id: "person-c", label: "Person C", revision: 3 }] : [{ id: "person-a", label: "Same Name", revision: 1 }, { id: "person-b", label: "Same Name", revision: 2 }] });
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("Finance-scoped audience selection", () => {
  it("keeps distinct same-name people and cross-page selections", async () => {
    const user = userEvent.setup(); mount(); const same = await screen.findAllByRole("checkbox", { name: /Same Name/ }); await user.click(same[0]!); expect(screen.getByText("1 person · 0 groups selected")).toBeVisible(); await user.click(same[1]!);
    expect(screen.getByText("Person · person-a")).toBeVisible(); expect(screen.getByText("Person · person-b")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" })); await user.click(await screen.findByRole("checkbox", { name: /Person C/ })); expect(screen.getByText("3 people · 0 groups selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous" })); await waitFor(() => expect(screen.getAllByRole("checkbox", { name: /Same Name/ }).every(input => (input as HTMLInputElement).checked)).toBe(true));
    expect(screen.getByText(/"person_ids":\["person-a","person-b","person-c"\]/)).toBeVisible();
  });
  it("retains group kind as well as ID and never treats a group count as people selected", async () => {
    const user = userEvent.setup(); mount(); await user.click(screen.getByRole("button", { name: "Groups", exact: true })); const groups = await screen.findAllByRole("checkbox", { name: /Robotics/ });
    expect(screen.getByText("Group · 1 member")).toBeVisible(); expect(screen.getByText("Learning group · 3 members")).toBeVisible(); await user.click(groups[0]!); expect(screen.getByText("0 people · 1 group selected")).toBeVisible(); await user.click(groups[1]!); expect(screen.getByText("0 people · 2 groups selected")).toBeVisible(); expect(screen.getByText(/"kind":"participation"/)).toBeVisible(); expect(screen.getByText(/"kind":"learning"/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "People", exact: true })); expect((await screen.findAllByRole("checkbox"))[0]).not.toBeChecked();
  });
  it("does not request People administration or offer import without permission", async () => {
    mount(); await screen.findAllByRole("checkbox"); expect(screen.queryByRole("button", { name: "Add people" })).not.toBeInTheDocument(); expect(vi.mocked(apiFetch).mock.calls.every(([path]) => path.includes("/fees/charge-audience/"))).toBe(true);
  });
  it("reuses Add people only under the explicit source capability", async () => {
    canAdd = true; const user = userEvent.setup(); mount(); await user.click(await screen.findByRole("button", { name: "Add people" })); expect(add).toHaveBeenCalledOnce();
  });
  it("does not expose cached private choices after explicit revocation", async () => {
    const client = mount(); await screen.findAllByRole("checkbox"); vi.mocked(apiFetch).mockRejectedValue(new ApiError("Finance access ended", 403)); await act(async () => { await client.refetchQueries(); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Finance access ended"); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "Use selection" })).toBeDisabled();
  });
  it("does not reuse a stale Add people capability after a catalogue refresh fails", async () => {
    canAdd = true; const client = mount(); await screen.findByRole("button", { name: "Add people" }); vi.mocked(apiFetch).mockRejectedValue(new ApiError("Refresh interrupted", 503)); await act(async () => { await client.refetchQueries(); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Add people" })).toBeDisabled()); expect(screen.getByRole("button", { name: "Use selection" })).toBeDisabled();
  });
});
