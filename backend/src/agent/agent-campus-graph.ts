import { ConflictException, Logger } from '@nestjs/common';
import { Annotation, Command, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { Pool } from 'pg';
import { z } from 'zod';
import { config } from '../config.js';
import { postgresClientConnectionConfig } from '../database/connection-policy.js';

const checkpointSchema = 'agent_campus_workflow';
const uuid = z.uuid().transform(value=>value.toLowerCase());
const planSchema = z.tuple([uuid,uuid]).refine(steps=>steps[0]!==steps[1]);
const receiptSchema = z.object({
  call_id:uuid,status:z.enum(['applied','blocked','stopped']),reported_status:z.literal('applied').optional(),
}).strict().refine(receipt=>receipt.reported_status===undefined||receipt.status==='blocked');
const interruptSchema = z.object({call_id:uuid}).strict();
const stateSchema = z.object({steps:planSchema,receipts:z.array(receiptSchema).max(2)}).refine(state=>
  state.receipts.every((receipt,index)=>receipt.call_id===state.steps[index]
    && (index===0||state.receipts[index-1]?.status==='applied')));
type Receipt = z.infer<typeof receiptSchema>;
type WorkflowState = z.infer<typeof stateSchema>;

export type CampusWorkflowSnapshot = { steps:string[]; receipts:Receipt[]; pending?:string; recovering?:true };

const graphState = Annotation.Root({
  steps:Annotation<WorkflowState['steps']>(),
  receipts:Annotation<Receipt[]>(),
});

function nextControl(state:WorkflowState) {
  const last = state.receipts.at(-1);
  return !last || last.status==='applied' ? state.steps[state.receipts.length] : undefined;
}

function compileCampusGraph(checkpointer:PostgresSaver) {
  return new StateGraph(graphState)
    .addNode('await_control', state=>{
      const callId=nextControl(state);
      if(!callId)throw new Error('Campus workflow has no remaining control.');
      const receipt=receiptSchema.parse(interrupt({call_id:callId}));
      if(receipt.call_id!==callId)throw new ConflictException('This is not the Assistant control awaiting a result.');
      return {receipts:[...state.receipts,receipt]};
    })
    .addEdge(START,'await_control')
    .addConditionalEdges('await_control',state=>nextControl(state)?'await_control':END)
    .compile({checkpointer});
}

type CampusGraph = ReturnType<typeof compileCampusGraph>;

/** The service owns the authenticated run and serializes mutations. This graph
 * stores the immutable control IDs and observed results for that run only. */
export class AgentCampusWorkflow {
  private readonly logger=new Logger(AgentCampusWorkflow.name);
  private runtime:{pool:Pool;graph:CampusGraph}|undefined;

  private getRuntime() {
    if(this.runtime)return this.runtime;
    const settings=config();
    const connection=postgresClientConnectionConfig(settings.DATABASE_URL,{
      name:'DATABASE_URL',purpose:'application',
      requireRemoteTls:settings.DEPLOYMENT_ENVIRONMENT==='stage'||settings.DEPLOYMENT_ENVIRONMENT==='production',
    });
    // The application may hold an advisory transaction while advancing the
    // graph. A separate one-slot pool also works when its pool has one slot.
    const pool=new Pool({...connection,max:1,connectionTimeoutMillis:5000,idleTimeoutMillis:30_000,
      statement_timeout:Math.min(settings.DATABASE_QUERY_TIMEOUT_MS,5000),
      idle_in_transaction_session_timeout:settings.DATABASE_IDLE_TRANSACTION_TIMEOUT_MS,
      application_name:'thatcampus_campus_workflow'});
    pool.on('error',()=>this.logger.warn('An idle campus workflow checkpoint connection closed.'));
    const checkpointer=new PostgresSaver(pool,undefined,{schema:checkpointSchema});
    this.runtime={pool,graph:compileCampusGraph(checkpointer)};
    return this.runtime;
  }

  async close() {
    const current=this.runtime;
    this.runtime=undefined;
    await current?.pool.end();
  }

  private runConfig(runId:string) {
    return {configurable:{thread_id:uuid.parse(runId)},recursionLimit:8,durability:'sync' as const};
  }

  private async read(graph:CampusGraph, options:ReturnType<AgentCampusWorkflow['runConfig']>) {
    const checkpoint=await graph.getState(options);
    if(!checkpoint.values?.steps)return undefined;
    const state=stateSchema.parse(checkpoint.values);
    const expected=nextControl(state);
    const interrupts=checkpoint.tasks.flatMap(task=>task.interrupts??[]);
    const open=interrupts[0];
    if(interrupts.length>1||open&&interruptSchema.parse(open.value).call_id!==expected) {
      throw new Error('Campus workflow checkpoint contains an unexpected interrupt.');
    }
    const unfinished=!!expected&&!open;
    const snapshot:CampusWorkflowSnapshot={steps:state.steps,receipts:state.receipts,
      ...(open&&expected?{pending:expected}:unfinished?{recovering:true}:{}),
    };
    return {snapshot,unfinished};
  }

  private async settled(graph:CampusGraph, options:ReturnType<AgentCampusWorkflow['runConfig']>) {
    const current=await this.read(graph,options);
    if(!current||current.unfinished)throw new Error('Campus workflow checkpoint did not reach a stable step.');
    return current.snapshot;
  }

  async start(runId:string, steps:readonly [string,string]):Promise<CampusWorkflowSnapshot> {
    const plan=planSchema.parse(steps), options=this.runConfig(runId);
    const {graph}=this.getRuntime();
    const current=await this.read(graph,options);
    if(current) {
      if(plan.some((id,index)=>id!==current.snapshot.steps[index]))throw new ConflictException('This Assistant run already has a different control plan.');
      if(!current.unfinished)return current.snapshot;
      await graph.invoke(null,options);
    } else await graph.invoke({steps:plan,receipts:[]},options);
    return this.settled(graph,options);
  }

  async current(runId:string):Promise<CampusWorkflowSnapshot|undefined> {
    const options=this.runConfig(runId);
    return (await this.read(this.getRuntime().graph,options))?.snapshot;
  }

  async acknowledge(runId:string, value:Receipt):Promise<CampusWorkflowSnapshot> {
    const receipt=receiptSchema.parse(value), options=this.runConfig(runId);
    const {graph}=this.getRuntime();
    const current=await this.read(graph,options);
    const previous=current?.snapshot.receipts.find(entry=>entry.call_id===receipt.call_id);
    if(current&&previous) {
      if(previous.status!==receipt.status||previous.reported_status!==receipt.reported_status)throw new ConflictException('A different result was already recorded for this Assistant control.');
      if(!current.unfinished)return current.snapshot;
      // The receipt persisted, but an interruption prevented the next wait
      // from being checkpointed. Finish advancing without applying it again.
      await graph.invoke(null,options);
      return this.settled(graph,options);
    }
    if(current?.snapshot.pending!==receipt.call_id)throw new ConflictException('This is not the Assistant control awaiting a result.');
    await graph.invoke(new Command({resume:receipt}),options);
    return this.settled(graph,options);
  }
}
