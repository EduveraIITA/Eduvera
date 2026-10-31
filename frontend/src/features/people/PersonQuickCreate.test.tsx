import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PersonQuickCreate } from "./PersonQuickCreate";
import { createParticipant } from "./participationApi";
vi.mock("./participationApi", () => ({ createParticipant: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("canonical no-account person creation", () => {
  it("creates a participant with a name only, without email, password, affiliation or invitation", async () => {
    const created = vi.fn();
    vi.mocked(createParticipant).mockResolvedValue({ id: "person-1", label: "Ravi", affiliations: [], has_account: false });
    render(<PersonQuickCreate schoolId="school-1" onClose={vi.fn()} onCreated={created} />);
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /invite/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/First name|Last name/)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "Ravi");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(expect.objectContaining({ id: "person-1", has_account: false })));
    const [school, body] = vi.mocked(createParticipant).mock.calls[0]!;
    expect(school).toBe("school-1");
    const { idempotency_key: retryKey, ...identity } = body;
    expect(identity).toEqual({ first_name: "Ravi", last_name: "" });
    expect(retryKey).toMatch(/^[a-f\d-]{36}$/);
  });
  it("keeps the entered identity and retry key after an unconfirmed failure", async () => {
    vi.mocked(createParticipant).mockRejectedValueOnce(new Error("Connection interrupted; creation was not confirmed.")).mockResolvedValueOnce({ id: "person-1", label: "Ravi Shah", affiliations: ["worker"], has_account: false });
    render(<PersonQuickCreate schoolId="school-1" onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "Ravi Shah");
    await userEvent.selectOptions(screen.getByLabelText(/Connection to campus/), "worker");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not confirmed");
    expect(screen.getByLabelText("Name")).toHaveValue("Ravi Shah");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(createParticipant).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createParticipant).mock.calls[0]?.[1].idempotency_key).toBe(vi.mocked(createParticipant).mock.calls[1]?.[1].idempotency_key);
  });
  it("uses a new key when the person changes after a failed command", async () => {
    vi.mocked(createParticipant).mockRejectedValue(new Error("Creation not confirmed"));
    render(<PersonQuickCreate schoolId="school-1" onClose={vi.fn()} onCreated={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Name"), "Ravi");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await screen.findByRole("alert");
    await userEvent.type(screen.getByLabelText("Name"), " Shah");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await waitFor(() => expect(createParticipant).toHaveBeenCalledTimes(2));
    expect(vi.mocked(createParticipant).mock.calls[0]?.[1].idempotency_key).not.toBe(vi.mocked(createParticipant).mock.calls[1]?.[1].idempotency_key);
  });

  it("preserves compound names, punctuation, scripts and internal spacing without guessing family names", async () => {
    vi.mocked(createParticipant).mockRejectedValue(new Error("Not confirmed"));
    render(<PersonQuickCreate schoolId="school-1" onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  María  del Pilar 李 O’Neill  " } });
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    await screen.findByRole("alert");
    expect(createParticipant).toHaveBeenCalledWith("school-1", expect.objectContaining({ first_name: "María  del Pilar 李 O’Neill", last_name: "" }));
    expect(screen.getByLabelText("Name")).toHaveValue("  María  del Pilar 李 O’Neill  ");
  });

  it("disables the entered identity and dismissal and ignores a duplicate submit while pending", async () => {
    let accept: (() => void) | undefined;
    vi.mocked(createParticipant).mockImplementation(() => new Promise(resolve => { accept = () => resolve({ id: "person-1", label: "Ravi Shah", affiliations: [], has_account: false }); }));
    const close = vi.fn(), created = vi.fn();
    render(<PersonQuickCreate schoolId="school-1" onClose={close} onCreated={created} />);
    await userEvent.type(screen.getByLabelText("Name"), "Ravi Shah");
    await userEvent.click(screen.getByRole("button", { name: "Add person" }));
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByLabelText(/Connection to campus/)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText("Name").closest("form")!);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: false, cancelable: true }));
    expect(createParticipant).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    await act(async () => { accept?.(); await Promise.resolve(); });
    expect(created).toHaveBeenCalledWith(expect.objectContaining({ label: "Ravi Shah" }));
  });

  it("rejects empty or oversized programmatic submissions without truncating or creating a person", () => {
    render(<PersonQuickCreate schoolId="school-1" onClose={vi.fn()} onCreated={vi.fn()} />);
    const name = screen.getByLabelText("Name");
    const form = name.closest("form")!;
    expect(name).toHaveAttribute("maxlength", "150");
    fireEvent.change(name, { target: { value: "   " } });
    fireEvent.submit(form);
    expect(screen.getByRole("alert")).toHaveTextContent("1–150 characters");
    const oversized = "A".repeat(151);
    fireEvent.change(name, { target: { value: oversized } });
    fireEvent.submit(form);
    expect(name).toHaveValue(oversized);
    expect(createParticipant).not.toHaveBeenCalled();
  });
});
