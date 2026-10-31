import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionEnvironmentProvider } from "../simulation/ExecutionEnvironmentContext";
import type { ExecutionEnvironment } from "../simulation/executionEnvironment";
import { executionEnvironmentQueryKey } from "../simulation/executionEnvironmentQueryKey";
import { PersonNameEditor } from "./PersonNameEditor";
import { correctParticipantName, getParticipant, type ParticipantDetail } from "./participationApi";
vi.mock("./participationApi", () => ({ getParticipant: vi.fn(), correctParticipantName: vi.fn() }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ user: { id: "owner" } }) }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
function mount(overrides: Partial<ParticipantDetail> = {}) {
  vi.mocked(getParticipant).mockResolvedValue({ id: "person-1", label: "Ravi Shah", first_name: "Ravi", last_name: "Shah", revision: 3,
    affiliation_sources: [{ affiliation: "worker", source: "staff profile" }], ...overrides });
  const saved = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ExecutionEnvironmentProvider environment={{ mode: "live" }}><PersonNameEditor schoolId="school-1" personId="person-1" onClose={vi.fn()} onSaved={saved} /></ExecutionEnvironmentProvider></QueryClientProvider>);
  return saved;
}
describe("institution person name correction", () => {
  it("requires a reason and corrects only institution person fields with the loaded revision", async () => {
    const saved = mount();
    expect(await screen.findByLabelText("Name")).toHaveValue("Ravi Shah");
    expect(screen.queryByLabelText(/First name|Last name/)).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Ravindra Shah");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    expect(screen.queryByLabelText(/email|password|permission/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Verified spelling against the campus record");
    vi.mocked(correctParticipantName).mockResolvedValue({ id: "person-1", label: "Ravindra Shah", revision: 4 });
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(saved).toHaveBeenCalledWith("Ravindra Shah"));
    const [school, person, body] = vi.mocked(correctParticipantName).mock.calls[0]!;
    expect([school, person]).toEqual(["school-1", "person-1"]);
    const { idempotency_key: retryKey, ...correction } = body;
    expect(correction).toEqual({ first_name: "Ravindra Shah", last_name: "", expected_revision: 3, reason: "Verified spelling against the campus record" });
    expect(retryKey).toMatch(/^[a-f\d-]{36}$/);
  });
  it("retains corrections and the same retry identity after failure, renewing it only when edited", async () => {
    mount();
    await userEvent.type(await screen.findByLabelText("Name"), "n");
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Reviewed campus name");
    vi.mocked(correctParticipantName).mockRejectedValue(new Error("The person changed. Close and reopen their details before correcting the name."));
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Close and reopen");
    expect(screen.getByLabelText("Name")).toHaveValue("Ravi Shahn");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctParticipantName).toHaveBeenCalledTimes(2));
    expect(vi.mocked(correctParticipantName).mock.calls[1]).toEqual(vi.mocked(correctParticipantName).mock.calls[0]);
    await userEvent.type(screen.getByLabelText("Reason for correction"), " again");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(correctParticipantName).toHaveBeenCalledTimes(3));
    expect(vi.mocked(correctParticipantName).mock.calls[2]![2].idempotency_key).not.toBe(vi.mocked(correctParticipantName).mock.calls[1]![2].idempotency_key);
  });

  it("does not turn an unchanged two-part name into an artificial correction", async () => {
    mount();
    const name = await screen.findByLabelText("Name");
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Checked existing campus name");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    fireEvent.change(name, { target: { value: "  Ravi Shah  " } });
    fireEvent.submit(name.closest("form")!);
    expect(correctParticipantName).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
  });

  it("keeps the complete corrected name intact rather than splitting on spaces", async () => {
    mount();
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "  María  del Pilar 李 O’Neill  " } });
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Confirmed complete name");
    vi.mocked(correctParticipantName).mockRejectedValue(new Error("Review required"));
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await screen.findByRole("alert");
    expect(correctParticipantName).toHaveBeenCalledWith("school-1", "person-1", expect.objectContaining({ first_name: "María  del Pilar 李 O’Neill", last_name: "", expected_revision: 3 }));
  });

  it("shows legacy long names in full and blocks oversized corrections without truncation", async () => {
    const first = "A".repeat(150), last = "B".repeat(150), full = `${first} ${last}`;
    mount({ first_name: first, last_name: last, label: full });
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue(full);
    expect(name).toHaveAccessibleDescription("This saved name is shown in full. A corrected name must be 150 characters or fewer.");
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Reviewed name");
    fireEvent.change(name, { target: { value: "C" + full.slice(1) } });
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    fireEvent.submit(name.closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("1–150 characters");
    expect(name).toHaveValue("C" + full.slice(1));
    expect(correctParticipantName).not.toHaveBeenCalled();
  });

  it("locks correction fields and ignores a second submission until the request settles", async () => {
    mount();
    vi.mocked(correctParticipantName).mockImplementation(() => new Promise(() => undefined));
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Ravindra Shah" } });
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Reviewed spelling");
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(name).toBeDisabled();
    expect(screen.getByLabelText("Reason for correction")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.submit(name.closest("form")!);
    expect(correctParticipantName).toHaveBeenCalledTimes(1);
  });

  it.each(["person", "world"] as const)("does not carry a dirty name or revision into another cached %s", async changed => {
    const live: ExecutionEnvironment = { mode: "live" }, simulation: ExecutionEnvironment = { mode: "simulation", namespaceId: "namespace", runId: "run", virtualClock: { now: "2026-10-21T10:00:00Z", timeZone: "UTC" } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const first = { id: "person-1", label: "Original Person", first_name: "Original", last_name: "Person", revision: 3, affiliation_sources: [] };
    const second = { ...first, id: changed === "person" ? "person-2" : "person-1", label: "Second Person", first_name: "Second", revision: 9 };
    const nextEnvironment = changed === "world" ? simulation : live;
    client.setQueryData(executionEnvironmentQueryKey(live, ["people.participants", "school-1", "detail", first.id]), first);
    client.setQueryData(executionEnvironmentQueryKey(nextEnvironment, ["people.participants", "school-1", "detail", second.id]), second);
    const tree = (environment: ExecutionEnvironment, id: string) => <QueryClientProvider client={client}><ExecutionEnvironmentProvider environment={environment}><PersonNameEditor schoolId="school-1" personId={id} onClose={vi.fn()} onSaved={vi.fn()} /></ExecutionEnvironmentProvider></QueryClientProvider>;
    const { rerender } = render(tree(live, first.id));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Unsaved original correction" } });
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Original person only");
    rerender(tree(nextEnvironment, second.id));
    expect(screen.getByLabelText("Name")).toHaveValue("Second Person");
    expect(screen.getByLabelText("Reason for correction")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save correction" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Second corrected name" } });
    await userEvent.type(screen.getByLabelText("Reason for correction"), "Second person only");
    vi.mocked(correctParticipantName).mockRejectedValue(new Error("Test refusal"));
    await userEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await screen.findByRole("alert");
    expect(correctParticipantName).toHaveBeenCalledWith("school-1", second.id, expect.objectContaining({ first_name: "Second corrected name", last_name: "", expected_revision: 9 }));
  });
});
