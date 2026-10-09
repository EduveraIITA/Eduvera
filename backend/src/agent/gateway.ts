import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { AgentScope, Capability } from './catalogue.js';

/** Ephemeral transport credentials. Never store or include these in a model prompt. */
export interface AgentCredentials { cookie: string; csrf: string; requestId: string }
export interface Evidence { id: string; title: string; href: string; retrieved_at: string; capability: string }

export function stableHash(value: unknown): string {
  function sorted(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sorted);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b)).map(([key,val]) => [key,sorted(val)]));
    return item;
  }
  return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}
export function collectIds(value: unknown, ids = new Set<string>()): Set<string> {
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value)) ids.add(value);
  else if (Array.isArray(value)) value.forEach(item => collectIds(item,ids));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectIds(item,ids));
  return ids;
}
export function redactEvidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(password|secret|token|cookie|download_url|invitation_url|recovery_code|latitude|longitude|latitude_deg|longitude_deg|location_trail|biometric|medical_notes|continuity_snapshot)/i.test(key))
    .map(([key,val]) => [key,redactEvidence(val)]));
  return value;
}
export function assertKnownIds(input: unknown, known: Set<string>) {
  const ids = collectIds(input);
  for (const id of ids) if (!known.has(id)) throw new BadRequestException('Read the target record first; identifiers must come from an authorized source.');
}
export function assertLocalScreen(path: string): string {
  if (!/^\/(principal|teacher|parent|student)(?:[/?]|$)/.test(path) && path !== '/account/security') throw new Error('Invalid agent screen.');
  if (path.includes('\\') || /[\r\n]/.test(path)) throw new Error('Invalid agent screen.');
  return path;
}

@Injectable()
export class AgentGateway {
  constructor(private readonly adapter: HttpAdapterHost) {}
  async dispatch(capability: Capability, input: unknown, scope: AgentScope, credentials: AgentCredentials, actionId?: string) {
    if (!capability.request || capability.kind === 'handoff') throw new ForbiddenException('This action must be completed in the app.');
    if (capability.kind === 'write' && !actionId) throw new ForbiddenException('An approved action is required.');
    const command = capability.request(input, scope, actionId);
    if (!command.path.startsWith('/') || command.path.includes('..') || command.path.includes('?') || command.path.includes('\\') || command.path.startsWith('//')) throw new BadRequestException('Invalid app operation.');
    const query = new URLSearchParams();
    for (const [key,value] of Object.entries(command.query ?? {})) if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') query.set(key,String(value));
    const app = this.adapter.httpAdapter.getInstance<FastifyInstance>();
    const response = await app.inject({ method: command.method, url: `/api/v1${command.path}${query.size ? `?${query.toString()}` : ''}`,
      headers: { cookie: credentials.cookie, 'x-csrftoken': credentials.csrf, 'x-request-id': credentials.requestId || randomUUID(), ...(actionId ? { 'idempotency-key':actionId } : {}), ...(command.body ? { 'content-type': 'application/json' } : {}) },
      ...(command.body ? { payload: JSON.stringify(command.body) } : {}),
    });
    if (response.body.length > 2_000_000) throw new BadRequestException('Narrow this request; the app returned too many records.');
    let body: unknown;
    try { body = response.body ? JSON.parse(response.body) : { completed: true }; }
    catch { throw new Error('The app returned an unreadable response.'); }
    if (response.statusCode >= 400) {
      const error = body as { detail?: unknown; error?: { detail?: unknown }; message?: unknown };
      const message = error.detail ?? error.error?.detail ?? error.message;
      const clean = typeof message === 'string' && !message.includes('<') ? message.slice(0,500) : `The app rejected this operation (${response.statusCode}).`;
      const failure = new BadRequestException(clean);
      Object.assign(failure, { appStatus: response.statusCode });
      throw failure;
    }
    return redactEvidence(body);
  }
}
