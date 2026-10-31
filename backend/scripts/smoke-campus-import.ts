/** Explicit, billable developer smoke test. Never included in automated tests. */
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { Database } from '../src/database/types.js';
import type { DatabaseService } from '../src/database/database.service.js';
import { CampusSceneImportProvider } from '../src/campus-scene-import/scene-import.provider.js';
import { CampusSceneImportService } from '../src/campus-scene-import/scene-import.service.js';
import { createCampusSceneFixture } from '../test/campus-scenes.test-support.js';
import { requireIsolatedTestDatabaseUrl } from '../test/test-database.js';

if(process.env.CAMPUS_SCENE_SMOKE_APPROVED!=='true')throw new Error('This test requires explicit approval for a synthetic Vertex call.');
const db=new Kysely<Database>({dialect:new PostgresDialect({pool:new Pool({connectionString:requireIsolatedTestDatabaseUrl(process.env.DATABASE_URL),max:3})})}) as DatabaseService;
const output=new URL('../../artifacts/virtual-campus-20261025/',import.meta.url);

function syntheticPlan() {
  const width=640,height=480,channels=3,rows=Buffer.alloc(height*(width*channels+1));
  const pixel=(x:number,y:number,r:number,g:number,b:number)=>{const at=y*(width*channels+1)+1+x*channels;rows[at]=r;rows[at+1]=g;rows[at+2]=b;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)pixel(x,y,211,225,192);
  const rect=(x:number,y:number,w:number,h:number,c:[number,number,number])=>{for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)pixel(px,py,...c);};
  rect(20,405,600,35,[99,106,105]);rect(292,40,30,365,[191,180,159]);rect(60,225,520,16,[191,180,159]);
  rect(65,70,150,100,[184,115,84]);rect(365,65,180,110,[159,166,170]);rect(65,275,135,90,[184,115,84]);
  rect(390,285,150,90,[89,145,104]);rect(395,290,140,3,[245,243,220]);rect(395,367,140,3,[245,243,220]);
  for(const [cx,cy] of [[40,65],[250,75],[565,65],[565,180],[250,300],[40,350],[340,350]])for(let y=cy!-12;y<=cy!+12;y++)for(let x=cx!-12;x<=cx!+12;x++)if((x-cx!)**2+(y-cy!)**2<=144)pixel(x,y,63,118,69);
  const crc=(data:Buffer)=>{let value=0xffffffff;for(const byte of data){value^=byte;for(let bit=0;bit<8;bit++)value=(value>>>1)^((value&1)?0xedb88320:0);}return(value^0xffffffff)>>>0;};
  const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),header=Buffer.alloc(4),footer=Buffer.alloc(4);header.writeUInt32BE(data.length);footer.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([header,type,data,footer]);};
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
try {
  await mkdir(output,{recursive:true});
  const f=await createCampusSceneFixture(db),provider=new CampusSceneImportProvider(),service=new CampusSceneImportService(db,f.scenes,provider);
  await f.run(async()=>{
    const png=syntheticPlan();await writeFile(new URL('synthetic-source.png',output),png);
    const source=await f.scenes.uploadImage(f.user,f.schoolId,f.campusId,{idempotency_key:randomUUID(),rights_confirmed:true,data_url:`data:image/png;base64,${png.toString('base64')}`});
    const request={kind:'image',idempotency_key:randomUUID(),image_asset_id:source.image.id,label:'Synthetic campus analysis test',source_kind:'site_plan',instructions:'This is an artificial campus plan used only to test the import workflow.'};
    const result=await service.import(f.user,f.schoolId,f.campusId,request);
    const replay=await service.import(f.user,f.schoolId,f.campusId,request);
    const receipt=(await sql<{input_tokens:number;max_output_tokens:number;reserved_micros:string;status:string}>`SELECT input_tokens,max_output_tokens,reserved_micros,status FROM campus_scene_import_runs WHERE id=${request.idempotency_key}::uuid`.execute(db)).rows[0]!;
    const report={provider:'vertex',model:'gemini-3.1-flash-lite',synthetic:true,element_count:result.document.elements.length,
      by_kind:Object.fromEntries([...new Set(result.document.elements.map(e=>e.kind))].map(kind=>[kind,result.document.elements.filter(e=>e.kind===kind).length])),
      all_require_review:result.document.elements.every(e=>e.review_state==='needs_review'),
      replay_identical:isDeepStrictEqual(result,replay),receipt};
    await writeFile(new URL('vertex-smoke.json',output),JSON.stringify(report,null,2));
    await writeFile(new URL('synthetic-ai-draft.json',output),JSON.stringify(result.document,null,2));
    console.log(JSON.stringify(report));
  });
} finally {await db.destroy();}
