import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { PoweredBy } from "./PoweredBy";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

it("renders the compact supplied logo credit without ribbon decoration", () => {
  const { container } = render(<PoweredBy className="powered-by--home" />);
  expect(screen.getByText("Powered by")).toBeVisible();
  expect(screen.getByRole("img", { name: "ThatCampus" })).toHaveClass("thatcampus-logo");
  expect(container.querySelector('img[src="/assets/thatcampus-wordmark-light-v3.png"]')).not.toBeNull();
  expect(container.querySelector('img[src="/assets/thatcampus-wordmark-dark-v3.png"]')).not.toBeNull();
  expect(container.querySelector(".powered-by__inline")).not.toBeNull();
  expect(container.querySelector(".powered-by__ribbon, i")).toBeNull();
  expect(container.querySelector(".powered-by--home")).not.toBeNull();
});

it("uses the theme-aware full artwork instead of forcing a light app shell", () => {
  document.documentElement.setAttribute("data-theme", "dark");
  const { container } = render(<PoweredBy />);
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(container.querySelector("filter, svg")).toBeNull();
  expect(container.firstChild).not.toHaveAttribute("data-appearance", "light");
  expect(screen.getByRole("img")).toHaveClass("thatcampus-logo");
});
