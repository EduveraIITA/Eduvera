import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const loader=readFileSync(new URL('../src/database/seed.ts',import.meta.url),'utf8');
const participation=readFileSync(new URL('../migrations/155_participation_attendance.sql',import.meta.url),'utf8');

describe('synthetic campus bootstrap attendance boundary',()=>{
  it('reports the canonical entry owner rather than retired attendance read views',()=>{
    expect(loader).toContain('FROM activity_attendance_entries');
    expect(participation).toContain('CREATE TABLE activity_attendance_entries');
    expect(loader).not.toContain('FROM attendance_records');
    expect(loader).not.toContain('FROM campus_event_attendance_records');
    expect(loader).toContain('Bootstrap does not fabricate attendance history');
  });
});
