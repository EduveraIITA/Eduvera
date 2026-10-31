import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Transaction } from 'kysely';
import type { Database } from '../database/types.js';

export const COORDINATION_CONFIGURATION_PORT = Symbol('COORDINATION_CONFIGURATION_PORT');
export const COORDINATION_CONFIGURATION_READ_PORT = Symbol('COORDINATION_CONFIGURATION_READ_PORT');
const identifier = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
export const coordinationRouteConfigurationSchema = z.object({
  school_id: z.string().uuid(), actor_user_id: z.string().uuid(),
  approval_command_id: z.string().uuid(), activation_command_id: z.string().uuid(),
  configuration_key: identifier, source_domain: identifier, source_record_id: z.string().min(1).max(160),
  source_revision: z.number().int().positive(), configuration_hash: z.string().regex(/^[0-9a-f]{64}$/),
  operating_rule_ref: z.string().min(3).max(240), effective_from: z.string().datetime({ offset: true }),
  enabled: z.boolean(), behaviour_key: identifier, behaviour_schema_version: z.number().int().positive(),
  behaviour_configuration: z.record(z.string(), z.unknown()),
  subscription: z.object({ source_domain: identifier, event_type: z.string().min(3).max(120),
    reaction_kind: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/), message_kind: z.enum(['request', 'task', 'offer', 'update']),
    selector_key: identifier, required_capability: z.string().min(3).max(120),
    scope_mode: z.enum(['institution','event_scope']), min_recipients: z.number().int().min(1).max(100),
    max_recipients: z.number().int().min(1).max(100), message_schema_version: z.number().int().positive(),
    // Explicit null means no response SLA or expiry; omission is not a default.
    response_due_after_seconds: z.number().int().min(1).max(31536000).nullable(),
    expires_after_seconds: z.number().int().min(1).max(31536000).nullable(),
    max_attempts: z.number().int().min(1).max(100), retry_after_seconds: z.number().int().min(1).max(604800).nullable(),
    priority: z.number().int().min(0).max(9),
  }).strict(),
  recipients: z.array(z.object({ person_id: z.string().uuid(), user_id: z.string().uuid() }).strict()).max(2000),
  approval_note: z.string().trim().min(5).max(1000),
}).strict().superRefine((value, context) => {
  if (value.subscription.source_domain !== value.source_domain) context.addIssue({ code: 'custom', path: ['subscription'], message: 'The route must belong to its approving domain.' });
  if (value.subscription.expires_after_seconds !== null && value.subscription.response_due_after_seconds !== null
    && value.subscription.expires_after_seconds < value.subscription.response_due_after_seconds) context.addIssue({ code: 'custom', path: ['subscription'], message: 'Expiry cannot precede the response deadline.' });
  if (value.subscription.max_recipients < value.subscription.min_recipients) context.addIssue({ code: 'custom', path: ['subscription'], message: 'Maximum recipients cannot be lower than minimum recipients.' });
  if (value.enabled && !value.recipients.length) context.addIssue({ code: 'custom', path: ['recipients'], message: 'Select at least one explicit recipient before activation.' });
  if (new Set(value.recipients.map(person => person.person_id)).size !== value.recipients.length
    || new Set(value.recipients.map(person => person.user_id)).size !== value.recipients.length) context.addIssue({ code: 'custom', path: ['recipients'], message: 'Each person/account may be selected once.' });
});
export type CoordinationRouteConfiguration = z.infer<typeof coordinationRouteConfigurationSchema>;
export type CoordinationRouteContent = Omit<CoordinationRouteConfiguration, 'approval_command_id' | 'activation_command_id' | 'configuration_hash'>;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
/** Exact approved behavior, timing, explicit recipient and source snapshot. */
export function coordinationConfigurationHash(value: CoordinationRouteContent): string {
  const { school_id, actor_user_id, configuration_key, source_domain, source_record_id, source_revision, operating_rule_ref,
    effective_from, enabled, behaviour_key, behaviour_schema_version, behaviour_configuration, subscription, recipients, approval_note } = value;
  return createHash('sha256').update(JSON.stringify(canonical({ school_id, actor_user_id, configuration_key, source_domain,
    source_record_id, source_revision, operating_rule_ref, effective_from, enabled, behaviour_key, behaviour_schema_version, behaviour_configuration, subscription,
    recipients: recipients.map(({ person_id, user_id }) => ({ person_id, user_id }))
      .sort((left, right) => left.person_id.localeCompare(right.person_id)), approval_note }))).digest('hex');
}
export interface CoordinationConfigurationReceipt {
  id: string; behaviour_version_id: string | null; subscription_id: string | null; configuration_hash: string;
}
/** Explicit owning-domain approval configures routing; it never accepts a duty. */
export interface CoordinationConfigurationPort {
  configureRoute(tx: Transaction<Database>, input: CoordinationRouteConfiguration): Promise<CoordinationConfigurationReceipt>;
}

/** Selected-world revision discovery for a stable owning-domain route key.
 * This does not return recipients, authority or permission to activate it. */
export interface CoordinationConfigurationReadPort {
  latestRevision(tx: Transaction<Database>, input: { school_id: string; source_domain: string; configuration_key: string }): Promise<number>;
}
