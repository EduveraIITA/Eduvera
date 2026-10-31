import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SchoolBrand } from "./SchoolBrand";

afterEach(cleanup);

it("preserves the institution crest and name rather than replacing campus identity with the app logo", () => {
  const { container } = render(<SchoolBrand name="Your campus"/>);
  expect(screen.getByText("Your campus")).toBeVisible();
  expect(container.querySelector(".school-brand__crest")).toHaveTextContent("YC");
  expect(container.querySelector(".thatcampus-logo")).toBeNull();
});

it("keeps an explicitly requested app mark decorative beside the retained campus crest", () => {
  const { container } = render(<SchoolBrand name="Your campus" showAppMark/>);
  expect(container.querySelector(".school-brand__crest")).toHaveTextContent("YC");
  expect(container.querySelector(".thatcampus-logo")).toHaveAttribute("aria-hidden", "true");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
