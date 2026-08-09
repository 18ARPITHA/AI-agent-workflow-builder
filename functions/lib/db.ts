import { Pool, PoolClient } from "pg";

// nhost injects the Postgres connection string as HASURA_GRAPHQL_DATABASE_URL
// into every function's environment. We use a service-level connection here
// deliberately — functions run with admin authority over these tables
// because workflow_runs / step_runs have NO Hasura permission for role
// "user" at all (see hasura/metadata). All row-level checks that matter
// (org membership + role, step-level gating, approver role) are done
// explicitly in code before any write happens — see permissions.ts.
const pool = new Pool({
  connectionString: process.env.HASURA_GRAPHQL_DATABASE_URL,
  max: 5,
});

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const { rows } = await pool.query(text, params);
  return rows;
}

export default pool;
