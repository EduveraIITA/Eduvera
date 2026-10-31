/** Server-only Matrix Client-Server API adapter. Never send the AS token to a browser. */
import { createHash } from "node:crypto";
import { assertLiveExternalEffect } from "../../common/simulation-effects.js";
import { captureSimulationProviderEffect, selectedSimulationResources, simulationLogicalDigest, } from "../../common/simulation-resources.js";
export function matrixSettings(env = process.env) {
    const enabled = env.MATRIX_ENABLED === "true";
    const settings = {
        enabled, baseUrl: env.MATRIX_INTERNAL_URL ?? "", serverName: env.MATRIX_SERVER_NAME ?? "",
        asToken: env.MATRIX_AS_TOKEN ?? "", botLocalpart: "eduvera_bot", requestTimeoutMs: 10_000,
    };
    if (!enabled)
        return settings;
    let url;
    try {
        url = new URL(settings.baseUrl);
    }
    catch {
        throw new Error("MATRIX_INTERNAL_URL must be a valid HTTP(S) origin.");
    }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error("MATRIX_INTERNAL_URL must be an HTTP(S) origin without credentials or a path.");
    }
    // Plain HTTP is only for a private, explicitly configured container/loopback hop.
    if (url.protocol === 'http:' && !['synapse', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
        throw new Error("Use HTTPS for a remote Synapse connection.");
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(settings.serverName)) {
        throw new Error("MATRIX_SERVER_NAME is missing or invalid.");
    }
    if (settings.asToken.length < 32)
        throw new Error("MATRIX_AS_TOKEN must be provided by a secret store.");
    settings.baseUrl = url.origin;
    return settings;
}
export function matrixLocalpart(schoolId, userId) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(schoolId) || !uuid.test(userId))
        throw new Error("Invalid Matrix identity scope.");
    return `edu_${schoolId.replaceAll('-', '').toLowerCase()}_${userId.replaceAll('-', '').toLowerCase()}`;
}
export function matrixTransactionId(outboxId) {
    return `eduvera_${createHash('sha256').update(outboxId).digest('hex')}`;
}
export class MatrixApiError extends Error {
    status;
    code;
    constructor(status, code) {
        // Do not include URLs, headers, access tokens or provider response bodies in errors.
        super(`Matrix request failed (${status}, ${code}).`);
        this.status = status;
        this.code = code;
    }
}
export class MatrixClient {
    settings;
    fetcher;
    constructor(settings, fetcher = fetch) {
        this.settings = settings;
        this.fetcher = fetcher;
    }
    /** Simulation has a run-local transport even when no Live Matrix provider is configured. */
    get simulationActive() { return selectedSimulationResources() !== null; }
    get available() { return this.simulationActive || this.settings.enabled; }
    get serverName() {
        return selectedSimulationResources() ? "simulation.invalid" : this.settings.serverName;
    }
    get botId() { return `@${this.settings.botLocalpart}:${this.serverName}`; }
    userId(schoolId, userId) {
        return `@${matrixLocalpart(schoolId, userId)}:${this.serverName}`;
    }
    async capture(operation, logicalKey, payload = {}) {
        await captureSimulationProviderEffect({
            kind: operation === "send" || operation === "redact" ? "operational_message" : "connector_call",
            provider: "matrix",
            operation,
            logicalKey,
            idempotencyKey: `matrix:${operation}:${simulationLogicalDigest(logicalKey)}`,
            payload,
        });
    }
    membershipKey(roomId) {
        return simulationLogicalDigest(`matrix:joined-members:${roomId}`);
    }
    async simulatedMembers(roomId) {
        const selected = selectedSimulationResources();
        if (!selected)
            throw new Error("Simulation Matrix state was requested outside Simulation.");
        const stored = await selected.artifacts.read(this.membershipKey(roomId));
        if (!stored)
            return [this.botId];
        try {
            const value = JSON.parse(stored.toString("utf8"));
            if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.startsWith("@") || !item.includes(":"))) {
                throw new Error("invalid membership state");
            }
            return [...new Set([this.botId, ...value])];
        }
        catch {
            throw new MatrixApiError(503, "M_SIMULATION_STATE_INVALID");
        }
    }
    async storeSimulatedMembers(roomId, members) {
        const selected = selectedSimulationResources();
        if (!selected)
            throw new Error("Simulation Matrix state was requested outside Simulation.");
        await selected.artifacts.write(this.membershipKey(roomId), Buffer.from(JSON.stringify([...new Set(members)].sort())), false);
    }
    async request(method, path, body, userId = this.botId) {
        if (!path.startsWith('/_matrix/') || path.includes('://') || path.includes('..'))
            throw new Error("Invalid Matrix API path.");
        if (selectedSimulationResources()) {
            const supported = (method === "GET" && path === "/_matrix/client/v3/account/whoami")
                || (method === "PUT" && /^\/_matrix\/client\/v3\/profile\/[^/]+\/displayname$/u.test(path));
            if (!supported)
                throw new MatrixApiError(503, "M_SIMULATION_UNSUPPORTED");
            await this.capture("request", `${method}:${path}:${userId}`, {
                method,
                path_hash: simulationLogicalDigest(path),
                body_hash: simulationLogicalDigest(JSON.stringify(body ?? null)),
            });
            return (path.endsWith("/account/whoami") ? { user_id: userId } : {});
        }
        assertLiveExternalEffect("External messaging");
        if (!this.settings.enabled)
            throw new MatrixApiError(503, "M_DISABLED");
        const url = new URL(path, this.settings.baseUrl);
        url.searchParams.set('user_id', userId);
        let response;
        try {
            response = await this.fetcher(url, {
                method, headers: { Authorization: `Bearer ${this.settings.asToken}`, 'Content-Type': 'application/json' },
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                redirect: 'error', signal: AbortSignal.timeout(this.settings.requestTimeoutMs),
            });
        }
        catch {
            throw new MatrixApiError(503, 'M_UNAVAILABLE');
        }
        if (!response.ok) {
            const failure = await response.json().catch(() => ({}));
            const code = typeof failure.errcode === 'string' && /^M_[A-Z_]+$/.test(failure.errcode) ? failure.errcode : 'M_UNKNOWN';
            throw new MatrixApiError(response.status, code);
        }
        try {
            return await response.json();
        }
        catch {
            throw new MatrixApiError(502, 'M_INVALID_RESPONSE');
        }
    }
    async register(userId) {
        if (selectedSimulationResources()) {
            await this.capture("register", userId, { identity_hash: simulationLogicalDigest(userId) });
            return;
        }
        const localpart = userId.slice(1, userId.indexOf(':'));
        try {
            await this.request('POST', '/_matrix/client/v3/register', { type: 'm.login.application_service', username: localpart, inhibit_login: true });
        }
        catch (error) {
            if (!(error instanceof MatrixApiError) || error.code !== 'M_USER_IN_USE')
                throw error;
        }
    }
    async ensureRoom(schoolId, conversationId) {
        if (selectedSimulationResources()) {
            const roomId = `!sim_${simulationLogicalDigest(`${schoolId}:${conversationId}`).slice(0, 40)}:simulation.invalid`;
            await this.capture("ensure_room", `${schoolId}:${conversationId}`, {
                school_ref: simulationLogicalDigest(schoolId),
                conversation_ref: simulationLogicalDigest(conversationId),
            });
            await this.storeSimulatedMembers(roomId, await this.simulatedMembers(roomId));
            return roomId;
        }
        const local = `edu_room_${matrixLocalpart(schoolId, conversationId).slice(4)}`;
        const alias = `#${local}:${this.settings.serverName}`;
        try {
            const existing = await this.request('GET', `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`);
            return await this.verifyRoom(existing.room_id, schoolId, conversationId);
        }
        catch (error) {
            if (!(error instanceof MatrixApiError) || error.code !== 'M_NOT_FOUND')
                throw error;
        }
        try {
            const result = await this.request('POST', '/_matrix/client/v3/createRoom', {
                room_alias_name: local, visibility: 'private', preset: 'private_chat',
                creation_content: { 'm.federate': false },
                initial_state: [
                    { type: 'm.room.join_rules', state_key: '', content: { join_rule: 'invite' } },
                    { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } },
                    { type: 'm.room.guest_access', state_key: '', content: { guest_access: 'forbidden' } },
                    { type: 'io.eduvera.scope', state_key: '', content: { school_id: schoolId, conversation_id: conversationId } },
                ],
                power_level_content_override: {
                    users: { [this.botId]: 100 }, users_default: 0, events_default: 0, state_default: 100,
                    invite: 100, kick: 100, ban: 100, redact: 100,
                    events: { 'm.room.power_levels': 100, 'm.room.encryption': 100, 'io.eduvera.scope': 100 },
                },
            });
            return await this.verifyRoom(result.room_id, schoolId, conversationId);
        }
        catch (error) {
            if (!(error instanceof MatrixApiError) || error.code !== 'M_ROOM_IN_USE')
                throw error;
            const existing = await this.request('GET', `/_matrix/client/v3/directory/room/${encodeURIComponent(alias)}`);
            return await this.verifyRoom(existing.room_id, schoolId, conversationId);
        }
    }
    async verifyRoom(roomId, schoolId, conversationId) {
        if (typeof roomId !== 'string' || !roomId.startsWith('!') || !roomId.includes(':')) {
            throw new MatrixApiError(502, 'M_INVALID_ROOM');
        }
        const scope = await this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/io.eduvera.scope/`);
        if (scope.school_id !== schoolId || scope.conversation_id !== conversationId) {
            throw new MatrixApiError(403, 'M_SCOPE_MISMATCH');
        }
        return roomId;
    }
    async join(roomId, userId) {
        if (selectedSimulationResources()) {
            const members = await this.simulatedMembers(roomId);
            await this.storeSimulatedMembers(roomId, [...members, userId]);
            await this.capture("join", `${roomId}:${userId}`, {
                room_ref: simulationLogicalDigest(roomId), identity_hash: simulationLogicalDigest(userId),
            });
            return;
        }
        await this.register(userId);
        await this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/invite`, { user_id: userId });
        await this.request('POST', `/_matrix/client/v3/join/${encodeURIComponent(roomId)}`, {}, userId);
    }
    async joinedMembers(roomId) {
        if (selectedSimulationResources())
            return this.simulatedMembers(roomId);
        const result = await this.request('GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/joined_members`);
        return Object.keys(result.joined);
    }
    async kick(roomId, userId) {
        if (selectedSimulationResources()) {
            const members = (await this.simulatedMembers(roomId)).filter((member) => member !== userId);
            await this.storeSimulatedMembers(roomId, members);
            await this.capture("kick", `${roomId}:${userId}`, {
                room_ref: simulationLogicalDigest(roomId), identity_hash: simulationLogicalDigest(userId),
            });
            return;
        }
        await this.request('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/kick`, { user_id: userId, reason: 'School access changed' });
    }
    async send(roomId, userId, transactionId, content, eventType = 'm.room.message') {
        if (selectedSimulationResources()) {
            const eventId = `$sim_${simulationLogicalDigest(`${roomId}:${transactionId}`).slice(0, 48)}`;
            await this.capture("send", `${roomId}:${transactionId}`, {
                room_ref: simulationLogicalDigest(roomId), sender_ref: simulationLogicalDigest(userId),
                transaction_ref: simulationLogicalDigest(transactionId), event_type: eventType,
                content_hash: simulationLogicalDigest(JSON.stringify(content)), synthetic: true,
            });
            return eventId;
        }
        const result = await this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${encodeURIComponent(transactionId)}`, content, userId);
        if (typeof result.event_id !== 'string' || !result.event_id.startsWith('$'))
            throw new MatrixApiError(502, 'M_INVALID_EVENT');
        return result.event_id;
    }
    async redact(roomId, eventId, transactionId) {
        if (selectedSimulationResources()) {
            await this.capture("redact", `${roomId}:${eventId}:${transactionId}`, {
                room_ref: simulationLogicalDigest(roomId), event_ref: simulationLogicalDigest(eventId), synthetic: true,
            });
            return;
        }
        await this.request('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/redact/${encodeURIComponent(eventId)}/${encodeURIComponent(transactionId)}`, { reason: 'Removed in ThatCampus' });
    }
}
//# sourceMappingURL=matrix-client.js.map