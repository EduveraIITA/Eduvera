/** Run as a separate always-on process; Cloud Run request CPU is not a job queue. */
import 'reflect-metadata';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseService } from '../../database/database.service.js';
import { MatrixTransportService } from './matrix-transport.service.js';

const db = new DatabaseService();
const transport = new MatrixTransportService(db);
let stopping = false;
process.once('SIGTERM', () => { stopping = true; });
process.once('SIGINT', () => { stopping = true; });
try {
  if (!transport.client.settings.enabled) throw new Error('MATRIX_ENABLED must be true for the Matrix worker.');
  while (!stopping) {
    try { await transport.drainPending(); }
    catch { console.error('Matrix worker iteration failed; queued events will be retried.'); }
    if (!stopping) await sleep(2000);
  }
} finally {
  await db.destroy();
}
