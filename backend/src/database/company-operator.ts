import { Pool } from 'pg';
import { postgresClientConnectionConfig } from './connection-policy.js';
const [action,email]=process.argv.slice(2);
if(!['grant','revoke'].includes(action ?? '') || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: node --import tsx src/database/company-operator.ts grant|revoke existing-user@email');
const url=process.env.DATABASE_URL;if(!url)throw new Error('DATABASE_URL is required.');
const pool=new Pool({...postgresClientConnectionConfig(url,{name:'DATABASE_URL',purpose:'migrations',requireRemoteTls:['production','stage'].includes(process.env.DEPLOYMENT_ENVIRONMENT ?? '')}),max:1});
const client=await pool.connect();
try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('company-operator-bootstrap',0))");
  const user=(await client.query('SELECT id FROM users WHERE lower(email)=lower($1) AND is_active FOR SHARE',[email])).rows[0];
  if(!user)throw new Error('An existing active account is required. This command does not create accounts or set passwords.');
  await client.query('INSERT INTO company_operators(user_id,is_active) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET is_active=excluded.is_active,granted_at=now()',[user.id,action==='grant']);
  await client.query("INSERT INTO company_audit(action,metadata) VALUES($1,jsonb_build_object('user_id',$2::text,'source','deployment-cli'))",['company.operator_'+action,user.id]);
  await client.query('COMMIT');process.stdout.write('Company operator access '+action+' completed.\n');
} catch(error) {await client.query('ROLLBACK');throw error;} finally {client.release();await pool.end();}
