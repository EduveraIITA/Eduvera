import { z } from "zod";
export const workspaceScopeKinds = [
    "self",
    "dependent",
    "institution",
    "campus",
    "class",
    "offering",
    "person",
    "event",
    "assessment",
    "trip",
    "space",
    "resource",
    "other",
];
export const effectiveScheduleSchema = z.object({
    time_zone: z.string().trim().min(1).max(100),
    weekly_windows: z.array(z.object({
        days: z.array(z.number().int().min(1).max(7)).min(1),
        starts_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        ends_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }).strict()).min(1),
}).strict().superRefine((value, context) => {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value.time_zone }).format();
    }
    catch {
        context.addIssue({ code: "custom", path: ["time_zone"], message: "Use a valid IANA timezone." });
    }
    value.weekly_windows.forEach((window, index) => {
        if (window.ends_at <= window.starts_at) {
            context.addIssue({
                code: "custom",
                path: ["weekly_windows", index, "ends_at"],
                message: "A duty window must end after it starts.",
            });
        }
    });
});
//# sourceMappingURL=workspace.contracts.js.map