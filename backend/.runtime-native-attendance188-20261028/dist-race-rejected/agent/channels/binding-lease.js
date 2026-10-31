import { Pool } from 'pg';
import { config } from '../../config.js';
import { postgresClientConnectionConfig } from '../../database/connection-policy.js';
import { assertLiveExternalEffect } from '../../common/simulation-effects.js';
/** Dedicated bounded session locks: never hold an operational transaction over HTTP,
 * and never consume the last application-pool connection while rechecking access. */
export class ChannelBindingLease {
    pool = null;
    async withOwner(provider, owner, action) {
        assertLiveExternalEffect('External assistant delivery');
        if (!this.pool) {
            const settings = config();
            this.pool = new Pool({ ...postgresClientConnectionConfig(settings.EVENT_DATABASE_URL ?? settings.DATABASE_URL, { name: 'EVENT_DATABASE_URL', purpose: 'events',
                    requireRemoteTls: ['stage', 'production'].includes(settings.DEPLOYMENT_ENVIRONMENT ?? settings.NODE_ENV) }),
                max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, application_name: 'thatcampus_channel_binding_lease' });
        }
        const client = await this.pool.connect();
        let locked = false;
        const key = `agent-channel:${provider}:owner:${owner}`;
        try {
            await client.query("SET lock_timeout='15s'");
            await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [key]);
            locked = true;
            return await action();
        }
        finally {
            let unsafe = false;
            if (locked)
                try {
                    await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [key]);
                }
                catch {
                    unsafe = true;
                }
            client.release(unsafe);
        }
    }
    async close() { await this.pool?.end(); }
}
//# sourceMappingURL=binding-lease.js.map