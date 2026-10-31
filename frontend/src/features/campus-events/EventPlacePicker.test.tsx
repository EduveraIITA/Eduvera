import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventPlacePicker } from "./EventPlacePicker";
import type { EventCatalogResponse } from "./types";

afterEach(cleanup);
const catalog: EventCatalogResponse = { class_sections: [], students: [], staff: [], subjects: [], places: [
  { id: "room-a", name: "Seminar 201", campus_id: "campus-a", campus_name: "Aaranya Campus" },
] };

describe("event place choices", () => {
  it("offers explicit inheritance, unmapped and canonical selection as different choices", async () => {
    const onChange = vi.fn();
    render(<EventPlacePicker catalog={catalog} allowInheritance inherit label="Research forum" onChange={onChange} />);
    fireEvent.click(screen.getByText("Map location"));
    const input = screen.getByLabelText("Map location for Research forum");
    await userEvent.selectOptions(input, "room-a");
    expect(onChange).toHaveBeenLastCalledWith({ space_id: "room-a", use_event_space: false });
    await userEvent.selectOptions(input, "");
    expect(onChange).toHaveBeenLastCalledWith({ space_id: null, use_event_space: false });
    await userEvent.selectOptions(input, "inherit");
    expect(onChange).toHaveBeenLastCalledWith({ space_id: null, use_event_space: true });
  });
  it("retains a saved unavailable choice without exposing its raw identity as display text", () => {
    render(<EventPlacePicker catalog={catalog} spaceId="private-space-id" onChange={() => undefined} />);
    expect(screen.getByLabelText("Map location for Event")).toHaveValue("private-space-id");
    expect(screen.queryByText("private-space-id")).not.toBeInTheDocument();
    expect(screen.getAllByText("Saved campus place")).toHaveLength(2);
  });
});
