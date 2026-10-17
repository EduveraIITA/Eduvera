import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PoweredBy } from "./PoweredBy";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

it("renders the compact original logo credit without ribbon decoration", () => {
  const { container } = render(<PoweredBy className="powered-by--home" />);
  expect(screen.getByText("Powered by")).toBeVisible();
  expect(screen.getByRole("img", { name: "ThatCampus" })).toHaveAttribute("src", "/assets/thatcampus-logo.png");
  expect(container.querySelector(".powered-by__inline")).not.toBeNull();
  expect(container.querySelector(".powered-by__ribbon, i")).toBeNull();
  expect(container.querySelector(".powered-by--home")).not.toBeNull();
});

it("keeps the full-color logo on the light app shell when the device prefers dark", () => {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
  document.documentElement.setAttribute("data-theme", "dark");
  const { container } = render(<PoweredBy />);
  expect(screen.getByRole("img")).toHaveAttribute("src", "/assets/thatcampus-logo.png");
  expect(container.firstChild).toHaveAttribute("data-appearance", "light");
});
