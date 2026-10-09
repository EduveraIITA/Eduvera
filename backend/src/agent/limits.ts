import { ForbiddenException, HttpException } from '@nestjs/common';
import { sql } from 'kysely';
import { z } from 'zod';
import type { DatabaseService } from '../database/database.service.js';

export function agentLimits() {
  return z.object({
    enabled: z.boolean(),
    until: z.string().optional(),
    hourly: z.coerce.number().int().min(1).max(60).default(10),
    daily: z.coerce.number().int().min(1).max(100).default(30),
    dailyMicros: z.coerce.number().int().min(1).max(2_000_000).default(500_000),
    monthlyMicros: z.coerce.number().int().min(1).max(20_000_000).default(5_000_000),
  }).parse({ enabled: process.env.AGENT_ENABLED !== 'false', until: process.env.AGENT_ENABLED_UNTIL,
    hourly: process.env.AGENT_USER_HOURLY_LIMIT, daily: process.env.AGENT_USER_DAILY_LIMIT,
    dailyMicros: process.env.AGENT_DAILY_BUDGET_MICROS, monthlyMicros: process.env.AGENT_MONTHLY_BUDGET_MICROS });
}

export function assertAgentEnabled() {
  const limits = agentLimits();
  if (!limits.enabled) throw new ForbiddenException('AI assistance is switched off. You can still use the app directly.');
  if (process.env.AGENT_PROVIDER === 'vertex') {
    const expiry = Date.parse(limits.until ?? '');
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new ForbiddenException('Cloud AI is paused until its trial allowance is reviewed.');
  }
  return limits;
}

export class AgentLimitError extends HttpException {
  constructor(message = 'The AI allowance has been reached. Please use the app directly for now.') { super(message, 429); }
}

// Reserve before the billable call. Never refund failures/cancellation: the remote
// provider may have completed them. Limits survive restarts and simultaneous runs.
// USD micro-units use conservative rates ($1/M input, $5/M output) above the
// reviewed Flash-Lite price. They are an app allowance, not Google's billing cap.
export async function reserveModelCall(db: DatabaseService, runId: string, inputTokens: number, outputTokens: number) {
  const limits = assertAgentEnabled();
  if (!Number.isSafeInteger(inputTokens) || inputTokens < 0 || inputTokens > 24000 || outputTokens !== 2048) {
    throw new AgentLimitError('This request is too large. Please ask about one class, person or date.');
  }
  const reserve = Math.ceil(inputTokens * 1.1) + 512 + outputTokens * 5;
  await db.transaction().execute(async tx => {
    await sql`SELECT pg_advisory_xact_lock(hashtext('agent_cloud_budget'))`.execute(tx);
    const active = (await sql`SELECT id FROM agent_runs WHERE id=${runId}::uuid AND status='running' AND lease_expires_at>now()`.execute(tx)).rows;
    if (!active.length) throw new AgentLimitError('This AI request is no longer active.');
    const usage = (await sql<{ day: number; month: number; calls: number }>`SELECT
      COALESCE(sum(reserved_micros) FILTER (WHERE created_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),0)::bigint AS day,
      COALESCE(sum(reserved_micros),0)::bigint AS month,
      count(*) FILTER (WHERE run_id=${runId}::uuid)::int AS calls
      FROM agent_model_usage WHERE created_at >= date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`.execute(tx)).rows[0]!;
    if (Number(usage.day) + reserve > limits.dailyMicros || Number(usage.month) + reserve > limits.monthlyMicros || usage.calls >= 10) throw new AgentLimitError();
    await sql`INSERT INTO agent_model_usage(run_id,input_tokens,max_output_tokens,reserved_micros)
      VALUES(${runId}::uuid,${inputTokens},${outputTokens},${reserve})`.execute(tx);
  });
}
