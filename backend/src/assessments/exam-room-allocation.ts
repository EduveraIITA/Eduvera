import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../database/types.js';

type Db = Kysely<Database> | Transaction<Database>;

const roomInput = z.object({
  space_id: z.string().uuid(),
  candidate_count: z.number().int().min(1).max(10000),
  invigilator_user_ids: z.array(z.string().uuid()).min(1).max(20),
}).strict();

export const examRoomAllocationsInput = z.array(roomInput).max(12).superRefine((rooms, ctx) => {
  if (rooms.length === 1) ctx.addIssue({code:'custom',message:'Use the ordinary room selection for one room.'});
  if (new Set(rooms.map(room => room.space_id)).size !== rooms.length)
    ctx.addIssue({code:'custom',message:'Choose different examination rooms.'});
  const invigilators = rooms.flatMap(room => room.invigilator_user_ids);
  if (new Set(invigilators).size !== invigilators.length)
    ctx.addIssue({code:'custom',message:'Assign each invigilator to only one simultaneous room.'});
});
export type ExamRoomAllocations = z.infer<typeof examRoomAllocationsInput>;

export function examRooms(db: Db, schoolId: string, sittingId: string) {
  return db.selectFrom('assessment_sitting_rooms as room')
    .innerJoin('campus_spaces as space',join => join.onRef('space.id','=','room.space_id').onRef('space.school_id','=','room.school_id'))
    .innerJoin('institution_campuses as campus','campus.id','room.campus_id')
    .select(['room.id','room.space_id','room.position','room.planned_candidates','space.name','space.code',
      'space.kind','space.capacity','space.status','space.is_bookable','space.revision','campus.name as campus_name'])
    .where('room.school_id','=',schoolId).where('room.sitting_id','=',sittingId).where('room.active','=',true)
    .orderBy('room.position').execute();
}

export async function saveExamRooms(db: Transaction<Database>, schoolId: string, sittingId: string, campusId: string, rooms: ExamRoomAllocations) {
  if (rooms.length) {
    const choices = await db.selectFrom('campus_spaces').select(['id','name','capacity']).where('school_id','=',schoolId)
      .where('campus_id','=',campusId).where('status','=','active').where('is_bookable','=',true)
      .where('id','in',rooms.map(room => room.space_id)).execute();
    const spaces = new Map(choices.map(space => [space.id,space]));
    for (const room of rooms) {
      const space = spaces.get(room.space_id);
      if (!space) throw new BadRequestException('Choose active bookable examination rooms at the same campus.');
      if (space.capacity === null || space.capacity < room.candidate_count)
        throw new BadRequestException(`Choose at most the recorded capacity for ${space.name}.`);
    }
  }
  await db.updateTable('assessment_sitting_rooms').set({active:false}).where('school_id','=',schoolId)
    .where('sitting_id','=',sittingId).where('active','=',true).execute();
  if (!rooms.length) return [];
  return db.insertInto('assessment_sitting_rooms').values(rooms.map((room,index) => ({
    school_id:schoolId,sitting_id:sittingId,space_id:room.space_id,campus_id:campusId,
    position:index+1,planned_candidates:room.candidate_count,
  }))).onConflict(conflict => conflict.columns(['sitting_id','space_id']).doUpdateSet(ref => ({
    active:true,position:ref.ref('excluded.position'),planned_candidates:ref.ref('excluded.planned_candidates'),
  }))).returning(['id','space_id']).execute();
}

export function frozenExamRoomIds(rooms: Array<{id:string;planned_candidates:number}>, candidateCount: number): Array<string|null> {
  if (!rooms.length) return Array.from({length:candidateCount}, () => null);
  const assigned = rooms.flatMap(room => Array.from({length:room.planned_candidates}, () => room.id));
  if (assigned.length !== candidateCount) throw new ConflictException('Room places must match the dated candidate count. Review the room allocations.');
  return assigned;
}
