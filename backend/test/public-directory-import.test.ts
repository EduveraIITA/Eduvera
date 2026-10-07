import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { importPublicSnapshot } from '../src/institutions/import-public-snapshot.js';

const suite = process.env.TEST_DATABASE_ISOLATED === 'true' ? describe : describe.skip;
suite('atomic public snapshot import', () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  afterAll(async () => { await pool.end(); });
  const header = 'name,institution_type,source,source_code,state,district,city,address,is_verified,metadata\n';
  const code = `C-${Date.now()}`;
  it('inserts unverified identities once and preserves an existing reviewed record', async () => {
    const client = await pool.connect();
    try {
      const input = `${header}Snapshot College,college,AISHE,${code},Delhi,New Delhi,,,false,{}\n`;
      expect((await importPublicSnapshot(client, Readable.from([input]))).inserted).toEqual([{ source: 'AISHE', count: '1' }]);
      const id = (await client.query<{id:string}>('SELECT id FROM institution_directory WHERE source=$1 AND source_code=$2', ['AISHE', code])).rows[0]!.id;
      await client.query("UPDATE institution_directory SET name='Reviewed College',is_verified=true WHERE id=$1", [id]);
      expect((await importPublicSnapshot(client, Readable.from([input]))).inserted).toEqual([]);
      expect((await client.query('SELECT id,name,is_verified FROM institution_directory WHERE id=$1', [id])).rows[0]).toEqual({ id, name: 'Reviewed College', is_verified: true });
    } finally { client.release(); }
  });
  it('rolls back a snapshot with conflicting official codes', async () => {
    const client = await pool.connect();
    const duplicateCode = `S-${Date.now()}`;
    try {
      const input = `${header}First,standalone,AISHE,${duplicateCode},Delhi,Delhi,,,false,{}\nSecond,standalone,AISHE,${duplicateCode},Delhi,Delhi,,,false,{}\n`;
      await expect(importPublicSnapshot(client, Readable.from([input]))).rejects.toMatchObject({ code: '23505' });
      expect((await client.query('SELECT 1 FROM institution_directory WHERE source_code=$1', [duplicateCode])).rowCount).toBe(0);
    } finally { client.release(); }
  });
  it('rejects verification and tenant-link claims from snapshot data', async () => {
    const client = await pool.connect();
    try {
      await expect(importPublicSnapshot(client, Readable.from([`${header}Fake verified,college,AISHE,C-99900001,Delhi,Delhi,,,true,{}\n`]))).rejects.toThrow('cannot verify');
      const withLink = header.trimEnd()+',existing_school_id\n';
      await expect(importPublicSnapshot(client, Readable.from([`${withLink}Fake link,college,AISHE,C-99900002,Delhi,Delhi,,,false,{},${randomUUID()}\n`]))).rejects.toThrow('cannot verify');
    } finally { client.release(); }
  });
});
