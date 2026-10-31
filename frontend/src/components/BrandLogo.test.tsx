import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BrandLogo } from "./BrandLogo";

const brandStyles = readFileSync(join(process.cwd(), "src/components/brand-logo.css"), "utf8");
const authStyles = readFileSync(join(process.cwd(), "src/features/auth/auth.css"), "utf8");
const storyStyles = readFileSync(join(process.cwd(), "src/devtools/onboarding-story.css"), "utf8");

let style: HTMLStyleElement;
beforeEach(() => {
  style = document.createElement("style");
  style.textContent = brandStyles;
  document.head.append(style);
});
afterEach(() => {
  cleanup();
  style.remove();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-execution-environment");
});

it("uses the supplied transparent variants with one accessible name and no synthetic colour filter", () => {
  const { container } = render(<BrandLogo className="compact-brand" width={56} height={34}/>);
  const logo = screen.getByRole("img", { name: "ThatCampus" });
  expect(logo).toHaveClass("thatcampus-logo", "compact-brand");
  expect(logo.style.getPropertyValue("--brand-logo-width")).toBe("56px");
  expect(logo.style.getPropertyValue("--brand-logo-height")).toBe("34px");
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(container.querySelector("svg, filter")).toBeNull();
  const artwork = [...logo.querySelectorAll("img")];
  expect(artwork.map(image => image.getAttribute("src"))).toEqual([
    "/assets/thatcampus-wordmark-light-v3.png", "/assets/thatcampus-wordmark-dark-v3.png",
  ]);
  artwork.forEach(image => {
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("aria-hidden", "true");
  });
  expect(brandStyles).not.toMatch(/filter\s*:/);
});

it("switches artwork immediately from resolved data-theme in both Live and Simulation", () => {
  const { container } = render(<BrandLogo/>);
  const light = container.querySelector(".thatcampus-logo__artwork--light");
  const dark = container.querySelector(".thatcampus-logo__artwork--dark");
  expect(light).toBeVisible();
  expect(dark).not.toBeVisible();
  document.documentElement.dataset.theme = "dark";
  expect(dark).toBeVisible();
  expect(light).not.toBeVisible();
  document.documentElement.dataset.executionEnvironment = "simulation";
  expect(dark).toBeVisible();
  document.documentElement.dataset.theme = "light";
  expect(light).toBeVisible();
  expect(dark).not.toBeVisible();
  expect(document.documentElement.dataset.executionEnvironment).toBe("simulation");
});

it("supports a decorative app mark without announcing a second institution identity", () => {
  const { container } = render(<BrandLogo alt=""/>);
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
});

it("preserves readable supplied lettering on the fixed-blue introduction and fixed-white design story", () => {
  style.textContent += authStyles + storyStyles;
  const { container } = render(<>
    <section className="auth-story"><BrandLogo/></section>
    <section className="screen"><BrandLogo/></section>
  </>);
  for (const appearance of ["light", "dark"]) {
    document.documentElement.dataset.theme = appearance;
    expect(container.querySelector(".auth-story .thatcampus-logo__artwork--light")).not.toBeVisible();
    expect(container.querySelector(".auth-story .thatcampus-logo__artwork--dark")).toBeVisible();
    expect(container.querySelector(".screen .thatcampus-logo__artwork--light")).toBeVisible();
    expect(container.querySelector(".screen .thatcampus-logo__artwork--dark")).not.toBeVisible();
  }
});
