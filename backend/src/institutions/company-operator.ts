import { Pool } from "pg";

const [action, email] = process.argv.slice(2);
if (!["grant", "revoke"].includes(action ?? "") || !email || !process.env.DATABASE_URL) throw new Error("Usage: DATABASE_URL=... node --import tsx src/institutions/company-operator.ts grant|revoke email");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const user = (await client.query<{ id: string }>("SELECT id FROM users WHERE lower(email)=lower($1) AND is_active FOR UPDATE", [email])).rows[0];
  if (!user) throw new Error("An existing active account is required.");
  if (action === "grant") await client.query("INSERT INTO company_operators(user_id) VALUES ($1) ON CONFLICT DO NOTHING", [user.id]);
  else await client.query("DELETE FROM company_operators WHERE user_id=$1", [user.id]);
  await client.query("INSERT INTO audit_events(action,actor_id,target_type,target_id,request_id,metadata) VALUES ($1,$2,'company_operator',$2,gen_random_uuid(),$3)", [`company_operator.${action}`,user.id,JSON.stringify({ via: "operator_cli" })]);
  await client.query("COMMIT");
  console.log(`Company operator ${action} completed.`);
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }
