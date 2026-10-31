import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSpace } from "../office/api";
import { ActivityPlaceQuickCreate } from "./ActivityPlaceQuickCreate";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../../lib/api";

vi.mock("../office/api", () => ({ createSpace: vi.fn() }));
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => { cleanup(); vi.resetAllMocks(); });
describe("inline canonical campus place creation", () => {
  it("creates a named place only on explicit save, retaining its retry identity and form after an error", async () => {
    const onCreated = vi.fn();
    vi.mocked(createSpace).mockRejectedValueOnce(new Error("Connection interrupted. Try again.")).mockResolvedValueOnce({ id: "gate", name: "North Gate", campus_id: "primary" } as Awaited<ReturnType<typeof createSpace>>);
    render(<MemoryRouter><ActivityPlaceQuickCreate schoolId="campus" campuses={[]} onClose={vi.fn()} onCreated={onCreated} /></MemoryRouter>);
    expect(createSpace).not.toHaveBeenCalled();
    expect(screen.getByText("Your primary campus will also be created.")).toBeVisible();
    expect(screen.getByText("Place details").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("Your activity stays open. Cancel to return without creating a place.")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Place name"), "North Gate");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection interrupted");
    expect(screen.getByLabelText("Place name")).toHaveValue("North Gate");
    expect(screen.getByLabelText("Place name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry same creation" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: "gate", label: "North Gate", campus_id: "primary" }));
    expect(vi.mocked(createSpace).mock.calls[0]).toEqual(vi.mocked(createSpace).mock.calls[1]);
    expect(createSpace).toHaveBeenCalledWith("campus", expect.objectContaining({ name: "North Gate", create_campus_if_missing: true, kind: "other" }));
    expect(vi.mocked(createSpace).mock.calls[0][1]).toHaveProperty("idempotency_key", expect.stringMatching(/^[a-f\d-]{36}$/));
    expect(vi.mocked(createSpace).mock.calls[0][1]).not.toHaveProperty("campus_id");
  });
  it("uses the explicit primary campus and changes the command identity when the payload changes", async () => {
    vi.mocked(createSpace).mockRejectedValue(new ApiError("Not saved", 400));
    render(<MemoryRouter><ActivityPlaceQuickCreate schoolId="campus" campuses={[{ id: "east", label: "East", is_primary: false }, { id: "west", label: "West", is_primary: true }]} onClose={vi.fn()} onCreated={vi.fn()} /></MemoryRouter>);
    expect(screen.getByLabelText("Campus")).toHaveValue("west");
    await userEvent.type(screen.getByLabelText("Place name"), "Workshop");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    await screen.findByRole("alert");
    await userEvent.selectOptions(screen.getByLabelText("Campus"), "east");
    await userEvent.click(screen.getByRole("button", { name: "Add place" }));
    await waitFor(() => expect(createSpace).toHaveBeenCalledTimes(2));
    expect(createSpace).toHaveBeenNthCalledWith(1, "campus", expect.objectContaining({ campus_id: "west" }));
    expect(createSpace).toHaveBeenNthCalledWith(2, "campus", expect.objectContaining({ campus_id: "east" }));
    expect(vi.mocked(createSpace).mock.calls[0][1]).not.toHaveProperty("idempotency_key", (vi.mocked(createSpace).mock.calls[1][1] as { idempotency_key: string }).idempotency_key);
  });
  it("does not guess among multiple campuses without a primary, and cancel never creates records", async () => {
    const onClose = vi.fn();
    render(<MemoryRouter><ActivityPlaceQuickCreate schoolId="campus" campuses={[{ id: "east", label: "East", is_primary: false }, { id: "west", label: "West", is_primary: false }]} onClose={onClose} onCreated={vi.fn()} /></MemoryRouter>);
    await userEvent.type(screen.getByLabelText("Place name"), "Workshop");
    expect(screen.getByRole("button", { name: "Add place" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(createSpace).not.toHaveBeenCalled();
  });
});
