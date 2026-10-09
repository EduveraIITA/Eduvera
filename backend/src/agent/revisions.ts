import { BadRequestException } from '@nestjs/common';

/** Bind concurrency tokens to the exact record read by the application, not to
 * a number reconstructed by the language model. Never pick an arbitrary row.
 */
export function recordRevision(data:unknown,targetId:string):number {
  const revisions=new Set<number>();
  function visit(value:unknown) {
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(!value||typeof value!=='object')return;
    const record=value as Record<string,unknown>;
    if(record.id===targetId && typeof record.revision==='number' && Number.isInteger(record.revision) && record.revision>=0) revisions.add(record.revision);
    Object.values(record).forEach(visit);
  }
  visit(data);
  if(revisions.size!==1)throw new BadRequestException('Read the exact record’s details before preparing this change. Its current version is not available unambiguously.');
  return [...revisions][0]!;
}
