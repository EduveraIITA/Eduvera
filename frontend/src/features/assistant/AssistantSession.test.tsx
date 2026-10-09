import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { AssistantSessionProvider, useDemoConversation } from "./AssistantSession";
import type { AssistantContext } from "./demoReplies";

const { auth } = vi.hoisted(() => ({ auth: { user: { id: "parent-1", active_school_id: "school-1" } } }));
vi.mock("../auth/AuthContext", () => ({ useOptionalAuth: () => auth }));
const wrapper = ({ children }: { children: ReactNode }) => <AssistantSessionProvider>{children}</AssistantSessionProvider>;
const context: AssistantContext = { portal: "parent", pageTitle: "Home", studentId: "child-1" };
afterEach(() => { cleanup(); auth.user = { id: "parent-1", active_school_id: "school-1" }; });

describe("demo conversation memory", () => {
  it("keeps conversation history across page contexts and clears just the current child", () => {
    const { result, rerender } = renderHook((value: AssistantContext) => useDemoConversation(value), { initialProps: context, wrapper });
    void act(() => result.current.append("Attendance?", { text: "Open attendance." }));
    rerender({ ...context, pageTitle: "Chat" });
    expect(result.current.turns).toHaveLength(1);
    rerender({ ...context, studentId: "child-2" });
    expect(result.current.turns).toHaveLength(0);
    void act(() => result.current.append("Transport?", { text: "Open transport." }));
    rerender({ ...context, portal: "student", studentId: undefined });
    expect(result.current.turns).toHaveLength(0);
    rerender(context);
    expect(result.current.turns[0].question).toBe("Attendance?");
    void act(() => result.current.clear());
    expect(result.current.turns).toHaveLength(0);
    rerender({ ...context, studentId: "child-2" });
    expect(result.current.turns[0].question).toBe("Transport?");
  });
  it.each(["account", "school"])("discards memory when the %s changes", scope => {
    const { result, rerender } = renderHook(() => useDemoConversation(context), { wrapper });
    void act(() => result.current.append("Hello", { text: "Hello." }));
    auth.user = scope === "account" ? { ...auth.user, id: "parent-2" } : { ...auth.user, active_school_id: "school-2" };
    rerender();
    expect(result.current.turns).toHaveLength(0);
  });
});
