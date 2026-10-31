import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { CampusSpaceEditor } from "./CampusSpaceEditor";
import { createSpace, updateSpace, type CampusSpace, type InstitutionCampus } from "./api";
import { ApiError } from "../../lib/api";
vi.mock("./api", async original => ({ ...await original<typeof import("./api")>(), createSpace: vi.fn(), updateSpace: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const campus: InstitutionCampus = { id: "campus", school_id: "school", name: "Main campus", code: "MAIN", campus_type: "main", status: "active", is_primary: true, parent_campus_id: null, address_line: "", city: "", state: "", postal_code: "", timezone: "Asia/Kolkata", revision: 1 };
const place: CampusSpace = { id: "place", school_id: "school", campus_id: "campus", parent_space_id: null, name: "Library", code: "LIB", kind: "library", capacity: null, is_accessible: false, is_bookable: false, status: "active", revision: 3 };
const data = { campuses: [campus, { ...campus, id: "branch", name: "Branch" }], spaces: [place, { ...place, id: "elsewhere", campus_id: "branch", name: "Other building", kind: "building" as const }] };
function show(space?: CampusSpace) { const saved = vi.fn(), close = vi.fn(); render(<MemoryRouter><CampusSpaceEditor schoolId="school" campusId="campus" data={data} space={space} defaults={{ name: "Library", kind: "library", parent_space_id: "elsewhere" }} onClose={close} onSaved={saved}/></MemoryRouter>); return { saved, close }; }

describe("shared canonical campus place editor", () => {
  it("creates only on explicit Save using the native idempotent command and excludes foreign-campus parents", async () => {
    vi.mocked(createSpace).mockResolvedValue(place); const user = userEvent.setup(); const { saved } = show();
    const dialog = screen.getByRole("dialog", { name: "Add space" });
    expect(createSpace).not.toHaveBeenCalled(); expect(within(dialog).getByLabelText("Inside (optional)")).toHaveValue("");
    expect(within(dialog).queryByRole("option", { name: "Other building" })).not.toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^Code/), "LIB"); await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createSpace).toHaveBeenCalledWith("school", expect.objectContaining({ campus_id: "campus", name: "Library", code: "LIB", kind: "library", parent_space_id: null, create_campus_if_missing: true, is_accessible: false }));
    expect(typeof (vi.mocked(createSpace).mock.calls[0]?.[1] as Record<string, unknown>).idempotency_key).toBe("string"); expect(saved).toHaveBeenCalledWith(place);
  });
  it("freezes an uncertain creation and retries its exact body and idempotency key", async () => {
    vi.mocked(createSpace).mockRejectedValueOnce(new Error("Response interrupted")).mockResolvedValueOnce(place); const user = userEvent.setup(); show();
    await user.type(screen.getByLabelText(/^Code/), "LIB"); await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Response interrupted"); expect(screen.getByLabelText("Space name")).toBeDisabled(); expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry same creation" }));
    expect(vi.mocked(createSpace).mock.calls[1]).toEqual(vi.mocked(createSpace).mock.calls[0]);
  });
  it("retains editable details after a definite native validation failure and supports Cancel", async () => {
    vi.mocked(createSpace).mockRejectedValue(new ApiError("Code already in use", 409)); const user = userEvent.setup(); const { close } = show();
    await user.type(screen.getByLabelText(/^Code/), "LIB"); await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByLabelText("Space name")).toHaveValue("Library"); expect(screen.getByLabelText(/^Code/)).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Cancel" })); expect(close).toHaveBeenCalledOnce();
  });
  it("does not link a late creation response into a different mounted workspace", async () => {
    let finish!: (place: CampusSpace) => void;
    vi.mocked(createSpace).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const saved = vi.fn(), user = userEvent.setup();
    const mounted = render(<MemoryRouter><CampusSpaceEditor schoolId="school" campusId="campus" data={data} defaults={{ name: "Library", kind: "library" }} onClose={vi.fn()} onSaved={saved}/></MemoryRouter>);
    await user.type(screen.getByLabelText(/^Code/), "LIB"); await user.click(screen.getByRole("button", { name: "Save" }));
    mounted.unmount(); await act(async () => { finish(place); await Promise.resolve(); });
    expect(saved).not.toHaveBeenCalled();
  });
  it("uses the existing record revision for edits and preserves native place kind", async () => {
    vi.mocked(updateSpace).mockResolvedValue(place); const user = userEvent.setup(); show(place);
    expect(screen.getByLabelText("Type")).toHaveValue("library"); await user.click(screen.getByRole("button", { name: "Save" }));
    expect(updateSpace).toHaveBeenCalledWith("school", "place", expect.objectContaining({ expected_revision: 3, kind: "library", is_bookable: false })); expect(createSpace).not.toHaveBeenCalled();
  });
});
