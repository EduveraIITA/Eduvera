import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThatCampusLoader } from "./ThatCampusLoader";

describe("ThatCampusLoader", () => {
  it("announces loading while presenting the supplied brand animation", () => {
    const view = render(<ThatCampusLoader label="Syncing school records…" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Syncing school records…");
    expect(status.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/thatcampus-loader-fast.svg",
    );
    view.rerender(<ThatCampusLoader />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading campus data…");
    expect(screen.getByRole("status")).not.toHaveTextContent(/live/i);
  });
});
