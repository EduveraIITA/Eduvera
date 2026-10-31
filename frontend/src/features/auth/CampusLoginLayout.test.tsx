import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CampusLoginLayout } from "./CampusLoginLayout";

vi.mock("./LoginTopography", () => ({ default: () => null }));
vi.mock("./useLoginTheme", () => ({ useLoginTheme: () => true }));
afterEach(cleanup);

it("reuses the shared supplied artwork on login without a recolouring filter", () => {
  const { container } = render(<CampusLoginLayout><p>Sign-in form</p></CampusLoginLayout>);
  expect(screen.getByRole("link", { name: "ThatCampus portal" })).toContainElement(screen.getByRole("img", { name: "ThatCampus" }));
  expect(screen.getByRole("img")).toHaveClass("thatcampus-logo", "campus-login__brand-logo");
  expect(container.querySelector('img[src="/assets/thatcampus-wordmark-dark-v3.png"]')).not.toBeNull();
  expect(container.querySelector("filter")).toBeNull();
  expect(container.firstChild).toHaveAttribute("data-login-theme", "dark");
  expect(screen.getByText("Sign-in form")).toBeVisible();
});

it("uses the actual account task as its single page heading without a second marketing introduction", () => {
  render(<CampusLoginLayout title="Reset your password" eyebrow="Account recovery" description="Request a reset link."><form aria-label="Recovery form"><button>Send reset link</button></form></CampusLoginLayout>);
  expect(screen.getAllByRole("heading",{level:1})).toHaveLength(1);
  expect(screen.getByRole("heading",{level:1,name:"Reset your password"})).toBeVisible();
  expect(screen.getByRole("form",{name:"Recovery form"})).toBeVisible();
  expect(screen.queryByText("School portal")).not.toBeInTheDocument();
  expect(screen.queryByText("School records that stay current.")).not.toBeInTheDocument();
});
