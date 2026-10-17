import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

it("updates the logo and appearance when the app theme changes", async () => {
  const { container } = render(<PoweredBy />);
  document.documentElement.setAttribute("data-theme", "dark");
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "/assets/thatcampus-logo-dark.png"));
  expect(container.firstChild).toHaveAttribute("data-appearance", "dark");
  document.documentElement.setAttribute("data-theme", "light");
  await waitFor(() => expect(screen.getByRole("img")).toHaveAttribute("src", "/assets/thatcampus-logo.png"));
});
