import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgentCampusWorkflow } from '../src/agent/agent-campus-graph.js';
import { DatabaseService } from '../src/database/database.service.js';
import { createClassPracticeFixture } from './class-practice.test-support.js';
import { requireIsolatedTestDatabaseUrl } from './test-database.js';

const enabled=process.env.TEST_DATABASE_ISOLATED==='true';
if(enabled)requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL);

describe.skipIf(!enabled)('Assistant campus graph checkpoint', ()=>{
  let db:DatabaseService, threadId:string;

  beforeAll(async()=>{
    db=new DatabaseService();
    const fixture=await createClassPracticeFixture(db);
    threadId=(await sql<{id:string}>`INSERT INTO agent_threads(owner_id,school_id,portal)
      VALUES(${fixture.owner.id}::uuid,${fixture.schoolId}::uuid,'principal') RETURNING id`.execute(db)).rows[0]!.id;
  });
  afterAll(async()=>{await db?.destroy();});

  async function withRun(test:(id:string,steps:readonly [string,string])=>Promise<void>) {
    const id=(await sql<{id:string}>`INSERT INTO agent_runs(thread_id,client_id,question,status,provider,model)
      VALUES(${threadId}::uuid,${randomUUID()}::uuid,'Prepare campus','running','ollama','fixture') RETURNING id`.execute(db)).rows[0]!.id;
    try {await test(id,[randomUUID(),randomUUID()]);}
    finally {await sql`DELETE FROM agent_runs WHERE id=${id}::uuid`.execute(db);}
  }

  it('starts once, survives runtime replacement, and rejects wrong or conflicting receipts',async()=>{
    await withRun(async(id,steps)=>{
      const first=new AgentCampusWorkflow();
      try {
        expect(await first.current(id)).toBeUndefined();
        expect(await db.transaction().execute(()=>first.start(id,steps))).toEqual({steps,receipts:[],pending:steps[0]});
        expect(await first.start(id,steps)).toEqual({steps,receipts:[],pending:steps[0]});
        await expect(first.start(id,[steps[0],randomUUID()])).rejects.toThrow('different control plan');
      } finally {await first.close();}

      const second=new AgentCampusWorkflow();
      const opened={call_id:steps[0],status:'applied'} as const;
      try {
        expect(await second.current(id)).toEqual({steps,receipts:[],pending:steps[0]});
        await expect(second.acknowledge(id,{call_id:steps[1],status:'applied'})).rejects.toThrow('awaiting a result');
        expect(await second.acknowledge(id,opened)).toEqual({steps,receipts:[opened],pending:steps[1]});
        expect(await second.acknowledge(id,opened)).toEqual({steps,receipts:[opened],pending:steps[1]});
        await expect(second.acknowledge(id,{...opened,status:'stopped'})).rejects.toThrow('different result');
      } finally {await second.close();}

      const third=new AgentCampusWorkflow();
      const prepared={call_id:steps[1],status:'applied'} as const;
      try {
        expect(await third.acknowledge(id,prepared)).toEqual({steps,receipts:[opened,prepared]});
        expect(await third.acknowledge(id,prepared)).toEqual({steps,receipts:[opened,prepared]});
        const before=(await sql<{count:number}>`SELECT count(*)::int AS count FROM agent_campus_workflow.checkpoints WHERE run_id=${id}::uuid`.execute(db)).rows[0]!.count;
        expect(before).toBeGreaterThan(0);
        await sql`DELETE FROM agent_runs WHERE id=${id}::uuid`.execute(db);
        expect(await third.current(id)).toBeUndefined();
      } finally {await third.close();}
    });
  });

  it('finishes advancing an already recorded receipt after losing the next interrupt write',async()=>{
    await withRun(async(id,steps)=>{
      const first=new AgentCampusWorkflow();
      const opened={call_id:steps[0],status:'applied'} as const;
      try {
        await first.start(id,steps);
        await first.acknowledge(id,opened);
      } finally {await first.close();}

      // Simulate the test worker stopping after saving the receipt checkpoint
      // and before saving the next interrupt. Do not remove the receipt.
      const removed=(await sql<{checkpoint_id:string}>`
        DELETE FROM agent_campus_workflow.checkpoint_writes
        WHERE run_id=${id}::uuid AND channel='__interrupt__' AND checkpoint_id=(
          SELECT checkpoint_id FROM agent_campus_workflow.checkpoints
          WHERE run_id=${id}::uuid ORDER BY checkpoint_id DESC LIMIT 1
        ) RETURNING checkpoint_id
      `.execute(db)).rows;
      expect(removed).toHaveLength(1);

      const resumed=new AgentCampusWorkflow();
      try {
        expect(await resumed.current(id)).toEqual({steps,receipts:[opened],recovering:true});
        expect(await resumed.acknowledge(id,opened)).toEqual({steps,receipts:[opened],pending:steps[1]});
      } finally {await resumed.close();}
    });
  });

  it('retains the client report when server authority blocks the step',async()=>{
    await withRun(async(id,steps)=>{
      const workflow=new AgentCampusWorkflow();
      try {
        await workflow.start(id,steps);
        const receipt={call_id:steps[0],status:'blocked',reported_status:'applied'} as const;
        expect(await workflow.acknowledge(id,receipt)).toEqual({steps,receipts:[receipt]});
        expect(await workflow.acknowledge(id,receipt)).toEqual({steps,receipts:[receipt]});
        await expect(workflow.acknowledge(id,{call_id:steps[0],status:'blocked'})).rejects.toThrow('different result');
      } finally {await workflow.close();}
    });
  });

  it.each(['blocked','stopped'] as const)('ends a workflow when its first control is %s',async status=>{
    await withRun(async(id,steps)=>{
      const workflow=new AgentCampusWorkflow();
      try {
        await workflow.start(id,steps);
        const first={call_id:steps[0],status};
        expect(await workflow.acknowledge(id,first)).toEqual({steps,receipts:[first]});
        await expect(workflow.acknowledge(id,{call_id:steps[1],status:'applied'})).rejects.toThrow('awaiting a result');
      } finally {await workflow.close();}
    });
  });
});
