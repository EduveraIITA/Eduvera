const supportedGoals = new Set([
    "attendance", "gate", "timetable", "assignments", "fees", "resources", "facilities", "accommodation", "dining", "examinations", "performance", "staff", "messages",
]);
/** Historical catalogue/resume routes are presentation data, never authority.
 * Resolve only known goal/path pairs into the current shared setup guide. This
 * works for retained first-use records without rewriting an applied migration or
 * losing the separately accepted operating destination.
 */
export function canonicalProgressiveGoalDestination(goal, destination) {
    if (!goal || !supportedGoals.has(goal) || !destination.startsWith("/") || destination.startsWith("//"))
        return destination;
    const route = new URL(destination, "https://thatcampus.invalid");
    if (route.origin !== "https://thatcampus.invalid")
        return destination;
    const legacyBase = "/principal/get-started";
    const queryGoal = route.searchParams.get("task");
    const legacyGoalPath = route.pathname === `${legacyBase}/${goal}` && (!queryGoal || queryGoal === goal);
    const legacyGoalQuery = route.pathname === legacyBase && queryGoal === goal
        && route.searchParams.getAll("task").length === 1;
    const legacyPerformance = goal === "performance" && route.pathname === "/principal/results";
    return legacyGoalPath || legacyGoalQuery || legacyPerformance
        ? `/more/setup/capabilities?task=${goal}` : destination;
}
//# sourceMappingURL=progressive-goal-destination.js.map