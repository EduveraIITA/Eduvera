import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
const prefix = "conversation-page-v1.";
const schema = z.object({
    version: z.literal(1), user_id: z.string().uuid(), namespace_id: z.string().min(1).max(180),
    search: z.string().max(120), student_id: z.string().uuid().nullable(),
    activity_at: z.string().datetime({ precision: 6 }), id: z.string().uuid(),
}).strict();
export function encodeChatDirectoryCursor(position) {
    return prefix + Buffer.from(JSON.stringify(schema.parse({ version: 1, ...position })), "utf8").toString("base64url");
}
/** Position only: the directory query always rechecks current participation. */
export function decodeChatDirectoryCursor(value, scope) {
    try {
        if (typeof value !== "string" || value.length > 2048 || !value.startsWith(prefix))
            throw new Error("Invalid cursor");
        const encoded = value.slice(prefix.length);
        if (!/^[A-Za-z0-9_-]+$/.test(encoded))
            throw new Error("Invalid encoding");
        const bytes = Buffer.from(encoded, "base64url");
        if (bytes.toString("base64url") !== encoded)
            throw new Error("Non-canonical encoding");
        const payload = JSON.parse(bytes.toString("utf8"));
        const parsed = schema.parse(payload);
        if (parsed.user_id !== scope.user_id || parsed.namespace_id !== scope.namespace_id || parsed.search !== scope.search || parsed.student_id !== scope.student_id)
            throw new Error("Different scope");
        return parsed;
    }
    catch {
        throw new BadRequestException("Invalid conversation cursor. Start from the first page and try again.");
    }
}
//# sourceMappingURL=chat-directory-cursor.js.map