import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ProductIcon, productIconForDestination, productIcons } from "./ProductIcon";
afterEach(cleanup);

describe("flat colourful product icon family", () => {
  it.each(Object.keys(productIcons) as Array<keyof typeof productIcons>)("renders %s as a labelled-context decoration, not a 3D image", name => {
    const { container } = render(<button type="button"><ProductIcon name={name} size={28} />Open feature</button>);
    const glyph = container.querySelector("svg")!;
    expect(glyph).toHaveAttribute("data-product-icon", name);
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    expect(glyph).toHaveAttribute("focusable", "false");
    expect(glyph).toHaveAttribute("width", "28");
    expect(glyph.querySelector("path")).not.toBeNull();
    expect(glyph.querySelector("linearGradient, radialGradient, filter, image")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Open feature" })).toBeInTheDocument();
  });
  it("distinguishes destinations even when a server hint is generic", () => {
    expect(productIconForDestination("/more/account", "settings")).toBe("profile");
    expect(productIconForDestination("/more/account/security", "settings")).toBe("security");
    expect(productIconForDestination("/more/simulation", "settings")).toBe("simulation");
    expect(productIconForDestination("/unknown", "untrusted")).toBe("settings");
  });
  it("retains the licence, excludes rejected raster assets and protects the original Assistant mark", () => {
    const root = resolve(process.cwd(), "..");
    expect(readFileSync(resolve(root, "frontend/public/licenses/phosphor-icons.txt"), "utf8")).toContain("Copyright (c) 2020 Phosphor Icons");
    expect(existsSync(resolve(root, "frontend/public/icons/features/calender.webp"))).toBe(false);
    expect(Object.hasOwn(productIcons, "assistant")).toBe(false);
    const assistant = readFileSync(resolve(root, "frontend/src/features/assistant/AssistantIcon.tsx"), "utf8");
    expect(assistant).toContain("thatcampus-agent-no-glow.svg");
    expect(assistant).not.toMatch(/ProductIcon|phosphor|RobotIcon/);
    const tab = readFileSync(resolve(root, "frontend/src/features/assistant/DemoChat.tsx"), "utf8");
    expect(tab).toContain("<AssistantIcon size={26}/>");
  });
});
