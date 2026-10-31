import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSimulationResources, unbindSimulationResources, type SimulationArtifactPort } from '../src/common/simulation-resources.js';
import { simulationRequestEnvironment } from '../src/database/simulation-world.service.js';
import { executionEnvironmentStorage } from '../src/campus-model-core/execution-time.runtime.js';
import { EXECUTION_EFFECT_KINDS } from '../src/campus-model-core/execution-effects.contracts.js';
import { ExecutionEffectRouter, RunScopedInMemoryExecutionEffectSink } from '../src/campus-model-core/execution-effects.runtime.js';
import { sendTransactionalEmail } from '../src/common/email-transport.js';
import { enqueueInvitation } from '../src/common/invitation-queue.js';
import { RazorpayClient } from '../src/operations/razorpay.client.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type DatabaseConnection } from 'kysely';
import type { Database } from '../src/database/types.js';
import { PaymentEmailService } from '../src/operations/payment-email.service.js';

const now = '2030-02-03T04:05:06.000Z';
const environment = simulationRequestEnvironment({ institution_id: '10000000-0000-4000-8000-000000000001',
  scenario_id: '20000000-0000-4000-8000-000000000001', run_id: '30000000-0000-4000-8000-000000000001',
  virtual_now: now, source_snapshot_ref: 'source', manifest_ref: 'finance-test', checked_at: now });

function resources() {
  const contents = new Map<string, Buffer>();
  const artifacts: SimulationArtifactPort = { write: (key, bytes) => { contents.set(key, Buffer.from(bytes)); return Promise.resolve(); },
    read: key => Promise.resolve(contents.get(key) ?? null), rename: () => Promise.resolve(), remove: () => Promise.resolve() };
  const router = new ExecutionEffectRouter();
  const sinks = EXECUTION_EFFECT_KINDS.map(kind => new RunScopedInMemoryExecutionEffectSink(kind, `test:${kind}`, environment));
  router.bindSimulationSinks({ environment, sinks });
  bindSimulationResources({ environment, artifacts, effects: router });
  return { contents, sinks };
}

afterEach(() => { unbindSimulationResources(environment.namespace_id); vi.unstubAllGlobals(); });

describe('Simulation finance and invitation boundary substitutes', () => {
  it('captures email and invitation delivery without provider calls or a usable invitation queue job', async () => {
    const { sinks } = resources();
    const fetcher = vi.fn().mockRejectedValue(new Error('No external calls'));
    vi.stubGlobal('fetch', fetcher);
    await executionEnvironmentStorage.run(environment, async () => {
      await sendTransactionalEmail({ to: 'private@example.test', senderName: 'Test', subject: 'Private subject', text: 'Private body' });
      const result = await enqueueInvitation({} as DatabaseService, { id: '40000000-0000-4000-8000-000000000001',
        email: 'private@example.test', token: 'not-a-live-code', expires_at: now });
      expect(result).toMatchObject({ delivery: 'manual', evidence_mode: 'simulation' });
    });
    const captured = sinks.find(sink => sink.kind === 'external_notification')!.records();
    expect(captured).toHaveLength(2);
    const serialized = JSON.stringify(captured);
    for (const secret of ['private@example.test', 'Private subject', 'Private body', 'not-a-live-code']) expect(serialized).not.toContain(secret);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('persists only a pending simulated order and never invents a capture, provider signature or webhook', async () => {
    const { contents } = resources();
    const fetcher = vi.fn().mockRejectedValue(new Error('No external calls'));
    vi.stubGlobal('fetch', fetcher);
    await executionEnvironmentStorage.run(environment, async () => {
      const client = new RazorpayClient();
      expect(client.enabled()).toBe(true);
      expect(client.keyId()).toBe('simulation_no_external_checkout');
      const order = await client.request<{ id: string; amount: number; receipt: string }>('orders', {
        amount: 1000, currency: 'INR', receipt: '40000000-0000-4000-8000-000000000001',
      });
      expect(order).toMatchObject({ amount: 1000, receipt: '40000000-0000-4000-8000-000000000001' });
      expect(order.id).toMatch(/^order_sim_/u);
      expect(await client.request(`orders/${order.id}/payments`)).toEqual({ items: [] });
      expect(() => client.verify(order.id, 'forged', '00'.repeat(32))).toThrow();
      expect(() => client.verifyWebhook(Buffer.from('forged'), '00'.repeat(32))).toThrow();
      await expect(client.request('payments/forged')).rejects.toThrow(/No provider was contacted/iu);
    });
    expect(contents.size).toBe(1);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('runs the native payment-email worker in Simulation without SMTP enablement or false acceptance', async () => {
    const { sinks } = resources();
    let queued = true;
    const transitions: unknown[][] = [];
    class ScriptedDriver extends DummyDriver {
      override acquireConnection(): Promise<DatabaseConnection> {
        return Promise.resolve({ executeQuery: <R>(query: { sql: string; parameters: readonly unknown[] }) => {
          let rows: unknown[] = [];
          if (query.sql.includes("WHERE id=(SELECT id FROM fee_payment_emails")) {
            if (queued) rows = [{ id: '40000000-0000-4000-8000-000000000001', order_id: '50000000-0000-4000-8000-000000000001',
              provider_payment_id: 'sim_attempt', payment_state: 'pending' }];
            queued = false;
          } else if (query.sql.includes('FROM fee_gateway_orders o JOIN fee_invoices')) {
            rows = [{ eligible: true, state: 'created', email: 'private@example.test', student_id: environment.run_id,
              invoice_id: environment.scenario_id, school: 'Scenario campus', student: 'Synthetic student', admission: 'S1',
              invoice: 'TEST1', description: 'Modeled fee', amount: 1000, providerPayment: 'sim_attempt', receipt: null, date: now }];
          } else if (query.sql.includes('SET delivery_state=$')) transitions.push([...query.parameters]);
          return Promise.resolve({ rows: rows as R[] });
        }, streamQuery: async function* () { yield await Promise.reject(new Error('No streams')); } });
      }
    }
    const db = new Kysely<Database>({ dialect: { createAdapter: () => new PostgresAdapter(),
      createDriver: () => new ScriptedDriver(), createIntrospector: value => new PostgresIntrospector(value),
      createQueryCompiler: () => new PostgresQueryCompiler() } });
    try {
      await executionEnvironmentStorage.run(environment, () => new PaymentEmailService(db as DatabaseService).deliverPending());
      expect(queued).toBe(false);
      expect(transitions.some(parameters => parameters[0] === 'skipped')).toBe(true);
      expect(transitions.some(parameters => parameters[0] === 'accepted')).toBe(false);
      expect(sinks.find(sink => sink.kind === 'external_notification')!.records()).toHaveLength(1);
    } finally { await db.destroy(); }
  });
});
