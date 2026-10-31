import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
const prefix = "message-page-v1.";
const payloadSchema = z.object({
    version: z.literal(1),
    conversation_id: z.string().uuid(),
    namespace_id: z.string().min(1).max(180),
    created_at: z.string().datetime({ precision: 6 }),
    id: z.string().uuid(),
}).strict();
export function encodeChatMessageCursor(position) {
    const payload = payloadSchema.parse({ version: 1, ...position });
    return prefix + Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
/** A cursor is a position, never authority. The caller must authorize the exact
 * conversation first; the owning query still uses the selected data plane. */
export function decodeChatMessageCursor(value, scope) {
    try {
        if (typeof value !== "string" || value.length > 768 || !value.startsWith(prefix))
            throw new Error("Invalid cursor");
        const encoded = value.slice(prefix.length);
        if (!/^[A-Za-z0-9_-]+$/.test(encoded))
            throw new Error("Invalid encoding");
        const bytes = Buffer.from(encoded, "base64url");
        if (bytes.toString("base64url") !== encoded)
            throw new Error("Non-canonical encoding");
        const parsed = JSON.parse(bytes.toString("utf8"));
        const payload = payloadSchema.parse(parsed);
        if (payload.conversation_id !== scope.conversation_id || payload.namespace_id !== scope.namespace_id)
            throw new Error("Different scope");
        return payload;
    }
    catch {
        throw new BadRequestException("Invalid message cursor. Reload this conversation and try again.");
    }
}
//# sourceMappingURL=chat-message-cursor.js.map