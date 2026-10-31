var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import { InternalAgentDelegationService } from '../auth/internal-agent-delegation.js';
export function stableHash(value) {
    function sorted(item) {
        if (Array.isArray(item))
            return item.map(sorted);
        if (item && typeof item === 'object')
            return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sorted(val)]));
        return item;
    }
    return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}
export function collectIds(value, ids = new Set()) {
    if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value))
        ids.add(value);
    else if (Array.isArray(value))
        value.forEach(item => collectIds(item, ids));
    else if (value && typeof value === 'object')
        Object.values(value).forEach(item => collectIds(item, ids));
    return ids;
}
export function redactEvidence(value) {
    if (Array.isArray(value))
        return value.map(redactEvidence);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !/(password|secret|token|cookie|download_url|invitation_url|recovery_code|latitude|longitude|latitude_deg|longitude_deg|location_trail|biometric|medical_notes|continuity_snapshot)/i.test(key))
            .map(([key, val]) => [key, redactEvidence(val)]));
    return value;
}
export function assertKnownIds(input, known) {
    const ids = collectIds(input);
    for (const id of ids)
        if (!known.has(id))
            throw new BadRequestException('Read the target record first; identifiers must come from an authorized source.');
}
// These are reviewed catalogue destinations, not an /areas capability. Their
// owning application routes still resolve current responsibility/relationship
// authority; accepting an evidence link never authorizes its records.
const neutralEvidenceScreens = new Set([
    '/areas/people/classes', '/areas/attendance/registers', '/areas/messages/conversations',
    '/areas/assessments/assigned', '/areas/assessments/manage', '/areas/assessments/results',
    '/areas/events/assigned', '/areas/events/manage', '/areas/events/calendar',
    '/areas/departure/plan', '/areas/departure/manage', '/areas/departure/operate',
    '/areas/insights', '/areas/insights/review', '/areas/insights/learning-review',
    '/areas/insights/followups', '/areas/insights/operations', '/areas/insights/finance',
]);
const evidenceRecordId = '[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}';
const neutralRecordScreen = new RegExp(`^/areas/(?:events/(?:assigned|manage|calendar)|departure/(?:manage/journeys|operate))/${evidenceRecordId}$`, 'u');
export function assertLocalScreen(path) {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')
        || [...path].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127))
        throw new Error('Invalid agent screen.');
    const origin = 'https://thatcampus.invalid';
    const screen = new URL(path, origin);
    const rawPathname = path.split(/[?#]/u, 1)[0];
    if (screen.origin !== origin || screen.hash || screen.pathname !== rawPathname || screen.pathname.includes('%') || screen.pathname.includes('//')) {
        throw new Error('Invalid agent screen.');
    }
    if (!/^\/(principal|teacher|parent|student)(?:\/|$)/u.test(screen.pathname) && screen.pathname !== '/account/security'
        && !neutralEvidenceScreens.has(screen.pathname) && !neutralRecordScreen.test(screen.pathname))
        throw new Error('Invalid agent screen.');
    return path;
}
let AgentGateway = class AgentGateway {
    adapter;
    delegations;
    constructor(adapter, delegations) {
        this.adapter = adapter;
        this.delegations = delegations;
    }
    async dispatch(capability, input, scope, credentials, actionId) {
        if (!capability.request || capability.kind === 'handoff')
            throw new ForbiddenException('This action must be completed in the app.');
        if (capability.kind === 'write' && !actionId)
            throw new ForbiddenException('An approved action is required.');
        const command = capability.request(input, scope, actionId);
        if (!command.path.startsWith('/') || command.path.includes('..') || command.path.includes('?') || command.path.includes('\\') || command.path.startsWith('//'))
            throw new BadRequestException('Invalid app operation.');
        const query = new URLSearchParams();
        for (const [key, value] of Object.entries(command.query ?? {}))
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
                query.set(key, String(value));
        const app = this.adapter.httpAdapter.getInstance();
        const delegation = credentials.delegatedUser ? this.delegations.issue(credentials.delegatedUser, credentials.requestId) : undefined;
        const response = await app.inject({ method: command.method, url: `/api/v1${command.path}${query.size ? `?${query.toString()}` : ''}`,
            headers: { ...(credentials.cookie ? { cookie: credentials.cookie } : {}), ...(credentials.csrf ? { 'x-csrftoken': credentials.csrf } : {}),
                ...(delegation ? { 'x-omnischool-agent-delegation': delegation } : {}),
                'x-request-id': credentials.requestId || randomUUID(), ...(actionId ? { 'idempotency-key': actionId } : {}), ...(command.body ? { 'content-type': 'application/json' } : {}) },
            ...(command.body ? { payload: JSON.stringify(command.body) } : {}),
        });
        if (response.body.length > 2_000_000)
            throw new BadRequestException('Narrow this request; the app returned too many records.');
        let body;
        try {
            body = response.body ? JSON.parse(response.body) : { completed: true };
        }
        catch {
            throw new Error('The app returned an unreadable response.');
        }
        if (response.statusCode >= 400) {
            const error = body;
            const message = error.detail ?? error.error?.detail ?? error.message;
            const clean = typeof message === 'string' && !message.includes('<') ? message.slice(0, 500) : `The app rejected this operation (${response.statusCode}).`;
            const failure = new BadRequestException(clean);
            Object.assign(failure, { appStatus: response.statusCode });
            throw failure;
        }
        return redactEvidence(body);
    }
};
AgentGateway = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [HttpAdapterHost, InternalAgentDelegationService])
], AgentGateway);
export { AgentGateway };
//# sourceMappingURL=gateway.js.map