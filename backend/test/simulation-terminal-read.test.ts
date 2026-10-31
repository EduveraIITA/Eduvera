import { describe, expect, it } from "vitest";
import { CompiledQuery, DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, type DatabaseConnection } from "kysely";
import type { Pool } from "pg";
import { SimulationBranchDriver, type SimulationBranch } from "../src/database/simulation-branch.driver.js";
import type { StoredSimulationSnapshot } from "../src/database/simulation-snapshot-store.js";
import { simulationSessionExecutionEnvironment } from "../src/auth/session-execution-environment.js";
import { executionEnvironmentStorage } from "../src/campus-model-core/execution-time.runtime.js";
import { PeopleImportService } from "../src/people/people-import.service.js";
import type { DatabaseService } from "../src/database/database.service.js";
import type { Database } from "../src/database/types.js";

const school="10000000-0000-4000-8000-000000000001",run="20000000-0000-4000-8000-000000000001",scenario="30000000-0000-4000-8000-000000000001",actor="40000000-0000-4000-8000-000000000001",job="50000000-0000-4000-8000-000000000001";
const branch:SimulationBranch={run_id:run,school_id:school,scenario_id:scenario,namespace_id:`scenario:${scenario}:run:${run}`,
  schema_name:`dt_run_${run.replaceAll('-','')}`,snapshot_id:run,virtual_now:'2026-10-24T00:00:00.000Z',time_zone:'UTC',revision:1};
const snapshot={catalogue:{tables:[{name:'people_imports',columns:['id'],foreign_keys:[],triggers:[],trigger_functions:[],defaults:[]}],
  functions:[{name:'purge_imports',definition:'CREATE FUNCTION purge_imports() RETURNS void AS $$ DELETE FROM people_imports $$ LANGUAGE SQL'}],views:[]}} as unknown as StoredSimulationSnapshot;

describe('terminal Simulation logical reads',()=>{
  it('denies direct and function-mediated writes after a durable seal while allowing reads',async()=>{
    const queries:string[]=[];
    const client={query:(source:string)=>{queries.push(source);return Promise.resolve({rows:source.startsWith('SELECT domain_read_only')?[{domain_read_only:true}]:[],command:'SELECT'});},release:()=>undefined};
    const driver=new SimulationBranchDriver({connect:()=>Promise.resolve(client)} as unknown as Pool,branch,snapshot);
    const connection=await driver.acquireConnection();
    try{
      await expect(connection.executeQuery(CompiledQuery.raw('UPDATE people_imports SET id=id'))).rejects.toThrow('read-only');
      await expect(connection.executeQuery(CompiledQuery.raw('SELECT purge_imports()'))).rejects.toThrow('read-only');
      await expect(connection.executeQuery(CompiledQuery.raw('SELECT id FROM people_imports'))).resolves.toMatchObject({rows:[]});
      expect(queries).not.toContain('UPDATE people_imports SET id=id');
      expect(queries).not.toContain('SELECT purge_imports()');
      expect(queries).toContain('SELECT id FROM people_imports');
    }finally{await driver.releaseConnection(connection);await driver.destroy();}
  });

  it('projects an expired import without purging domain rows or appending audits when terminal',async()=>{
    const queries:string[]=[];
    class ReadDriver extends DummyDriver{override acquireConnection():Promise<DatabaseConnection>{return Promise.resolve({executeQuery:<R>(query:CompiledQuery)=>{
      queries.push(query.sql);let rows:unknown[]=[];
      if(query.sql.includes('FROM school_memberships membership'))rows=[{role:'admin'}];
      else if(query.sql.includes('FROM people_imports WHERE'))rows=[{id:job,school_id:school,filename:'expired.csv',state:'draft',revision:1,row_count:1,created_at:new Date('2026-10-20'),expires_at:new Date('2026-10-21'),receipt:null}];
      return Promise.resolve({rows:rows as R[]});},streamQuery:async function*(){yield await Promise.resolve({rows:[]});}});}}
    const db=new Kysely<Database>({dialect:{createDriver:()=>new ReadDriver(),createAdapter:()=>new PostgresAdapter(),createQueryCompiler:()=>new PostgresQueryCompiler(),createIntrospector:d=>new PostgresIntrospector(d)}});
    const selected=simulationSessionExecutionEnvironment({institution_id:school,scenario_id:scenario,run_id:run,namespace_id:`scenario:${scenario}:run:${run}`,
      virtual_now:branch.virtual_now,time_zone:'UTC',source_snapshot_at:branch.virtual_now,source_snapshot_ref:'snapshot',expires_at:'2099-01-01T00:00:00.000Z',run_status:'stopped'},
      {manifest_ref:'terminal-test',checked_at:branch.virtual_now});
    try{
      const result=await executionEnvironmentStorage.run(selected.environment!,()=>new PeopleImportService(db as DatabaseService,{} as never).detail({id:actor} as never,job,school));
      expect(result).toMatchObject({state:'expired',revision:1,review:null});
      expect(queries.some(query=>/\b(?:UPDATE|INSERT|DELETE)\b/u.test(query))).toBe(false);
    }finally{await db.destroy();}
  });
});
