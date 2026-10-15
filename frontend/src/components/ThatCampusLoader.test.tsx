import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThatCampusLoader } from "./ThatCampusLoader";

describe("ThatCampusLoader", () => {
  it("announces loading while presenting the supplied brand animation", () => {
    render(<ThatCampusLoader label="Syncing school records…" />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Syncing school records…");
    expect(status.querySelector("img")).toHaveAttribute(
      "src",
      "/assets/thatcampus-loader.svg",
    );
  });
});
