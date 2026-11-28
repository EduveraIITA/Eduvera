import { ForbiddenException, HttpException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { DatabaseService } from '../database/database.service.js';
import { VERTEX_ASSISTANT_MODEL } from './vertex-auth.js';

export const VERTEX_ASSISTANT_OUTPUT_TOKENS = { medium: 4096, high: 8192 } as const;

// Deployment-owned resource limits: school admins cannot raise shared billing caps.
export function agentExecutionLimits() {
  return z.object({
    modelCalls: z.coerce.number().int().min(1).max(20).default(10),
    tools: z.coerce.number().int().min(1).max(40).default(12),
    batch: z.coerce.number().int().min(1).max(4).default(4),
  }).parse({ modelCalls: process.env.AGENT_MAX_MODEL_CALLS, tools: process.env.AGENT_MAX_TOOL_CALLS, batch: process.env.AGENT_MAX_TOOL_BATCH });
}

export function agentLimits() {
  return z.object({
    enabled: z.boolean(),
    until: z.string().optional(),
    hourly: z.coerce.number().int().min(1).max(60).default(10),
    daily: z.coerce.number().int().min(1).max(100).default(30),
    dailyMicros: z.coerce.number().int().min(1).max(10_000_000).default(500_000),
    monthlyMicros: z.coerce.number().int().min(1).max(70_000_000).default(5_000_000),
  }).parse({ enabled: process.env.AGENT_ENABLED !== 'false', until: process.env.AGENT_ENABLED_UNTIL,
    hourly: process.env.AGENT_USER_HOURLY_LIMIT, daily: process.env.AGENT_USER_DAILY_LIMIT,
    dailyMicros: process.env.AGENT_DAILY_BUDGET_MICROS, monthlyMicros: process.env.AGENT_MONTHLY_BUDGET_MICROS });
}

const campusTrialBudget = z.object({
  dailyMicros: z.coerce.number().int().min(1).max(10_000_000),
  monthlyMicros: z.coerce.number().int().min(1).max(70_000_000),
});

export function assertAgentEnabled(scope?: 'campus_map_review') {
  const limits = agentLimits();
  if (!limits.enabled) throw new ForbiddenException('AI assistance is switched off. You can still use the app directly.');
  if (process.env.AGENT_PROVIDER !== 'vertex') return limits;

  const mapExpiry = scope === 'campus_map_review' ? process.env.CAMPUS_MAP_AI_ENABLED_UNTIL : undefined;
  if (mapExpiry !== undefined && !z.iso.datetime({ offset: true }).safeParse(mapExpiry).success)
    throw new ForbiddenException('Campus map AI review has an invalid trial expiry.');
  const expiry = Date.parse(mapExpiry ?? limits.until ?? '');
  if (!Number.isFinite(expiry) || expiry <= Date.now())
    throw new ForbiddenException('Cloud AI is paused until its trial allowance is reviewed.');
  if (mapExpiry === undefined) return limits;

  // The campus trial uses the same durable shared reservation ledger. Only
  // requests under its explicit, active window can use its higher ceiling.
  const budget = campusTrialBudget.parse({
    dailyMicros: process.env.CAMPUS_MAP_AI_DAILY_BUDGET_MICROS ?? limits.dailyMicros,
    monthlyMicros: process.env.CAMPUS_MAP_AI_MONTHLY_BUDGET_MICROS ?? limits.monthlyMicros,
  });
  return { ...limits, ...budget };
}

export class AgentLimitError extends HttpException {
  constructor(message = 'The AI allowance has been reached. Please use the app directly for now.') { super(message, 429); }
}

// Reserve before the billable call. Never refund failures/cancellation: the remote
// provider may have completed them. Limits survive restarts and simultaneous runs.
export async function reserveModelCall(db: DatabaseService, runId: string, inputTokens: number, outputTokens: number) {
  const limits = assertAgentEnabled();
  const flashOutput = outputTokens === VERTEX_ASSISTANT_OUTPUT_TOKENS.medium || outputTokens === VERTEX_ASSISTANT_OUTPUT_TOKENS.high;
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > 24000 || !(flashOutput || outputTokens === 2048)) {
    throw new AgentLimitError('This request is too large. Please ask about one class, person or date.');
  }
  await db.transaction().execute(async tx => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('agent_cloud_budget'))`.execute(tx);
    const active = (await sql<{ provider: string; model: string }>`SELECT provider,model FROM agent_runs WHERE id=${runId}::uuid AND status='running' AND lease_expires_at>now()`.execute(tx)).rows[0];
    if (!active) throw new AgentLimitError('This AI request is no longer active.');
    const flash = active.model === VERTEX_ASSISTANT_MODEL;
    if (active.provider !== 'vertex' || flash !== flashOutput || (!flash && active.model !== 'gemini-3.1-flash-lite')) {
      throw new AgentLimitError('This AI request no longer matches its model allowance. Please try again.');
    }
    const paddedInput = Math.ceil(inputTokens * 1.1) + 512;
    // USD micros: 3.8 rates round up the full published post-promotion rates
    // ($1.50/M input and $7.50/M output). The output envelope includes hidden
    // reasoning, with headroom for extra generation in provider usage records.
    const reserve = flash ? paddedInput * 2 + outputTokens * 2 * 8 : paddedInput + outputTokens * 5;
    const usage = (await sql<{ day: number; month: number; calls: number }>`SELECT
      COALESCE(sum(reserved_micros) FILTER (WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS day,
      COALESCE(sum(reserved_micros),0)::bigint AS month,
      count(*) FILTER (WHERE run_id=${runId}::uuid)::int AS calls
      FROM (SELECT reserved_micros,created_at,run_id FROM agent_model_usage
        UNION ALL SELECT reserved_micros,created_at,NULL::uuid AS run_id FROM campus_scene_import_runs) usage
      WHERE created_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(tx)).rows[0]!;
    if (Number(usage.day) + reserve > limits.dailyMicros || Number(usage.month) + reserve > limits.monthlyMicros || usage.calls >= agentExecutionLimits().modelCalls) throw new AgentLimitError();
    await sql`INSERT INTO agent_model_usage(run_id,input_tokens,max_output_tokens,reserved_micros)
      VALUES(${runId}::uuid,${inputTokens},${outputTokens},${reserve})`.execute(tx);
  });
}
