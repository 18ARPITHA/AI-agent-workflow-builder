import { PoolClient } from "pg";

export type OrgRole = "owner" | "editor" | "viewer";

export interface SessionVariables {
  "x-hasura-role"?: string;
  "x-hasura-user-id"?: string;
  [key: string]: string | undefined;
}

/** Hasura Actions POST { action, input, session_variables, request_query }. */
export function parseActionPayload(body: any) {
  return {
    input: body.input ?? {},
    sessionVariables: (body.session_variables ?? {}) as SessionVariables,
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Returns the caller's role in the given org, or null if not a member. */
export async function getOrgRole(
  client: PoolClient,
  orgId: string,
  userId: string
): Promise<OrgRole | null> {
  const { rows } = await client.query(
    `select role from org_members where org_id = $1 and user_id = $2`,
    [orgId, userId]
  );
  return rows[0]?.role ?? null;
}

/** Layer 1, enforced in code for the Action handlers (mirrors the Hasura
 *  permission rules for the tables the Action writes to on the user's behalf). */
export async function requireOrgRole(
  client: PoolClient,
  orgId: string,
  userId: string,
  allowed: OrgRole[]
): Promise<OrgRole> {
  const role = await getOrgRole(client, orgId, userId);
  if (!role || !allowed.includes(role)) {
    throw new HttpError(403, `requires role ${allowed.join("/")} in this organization`);
  }
  return role;
}

/** Validates an external webhook caller against an enabled webhook trigger
 *  for this workflow. Used by the public-role path of triggerWorkflowRun. */
export async function verifyWebhookToken(
  client: PoolClient,
  workflowId: string,
  token: string | undefined
): Promise<void> {
  if (!token) throw new HttpError(401, "webhook_token required for unauthenticated calls");
  const { rows } = await client.query(
    `select id from workflow_triggers
       where workflow_id = $1 and type = 'webhook' and is_enabled = true
         and config->>'webhook_token' = $2`,
    [workflowId, token]
  );
  if (rows.length === 0) throw new HttpError(403, "invalid webhook token for this workflow");
}

export async function getOrgQuota(client: PoolClient, orgId: string) {
  const { rows } = await client.query(
    `select quota_used, quota_allowed, quota_reset_at from organizations where id = $1`,
    [orgId]
  );
  if (rows.length === 0) throw new HttpError(404, "organization not found");
  return rows[0] as { quota_used: number; quota_allowed: number; quota_reset_at: string };
}

export async function assertQuotaAvailable(client: PoolClient, orgId: string) {
  const { quota_used, quota_allowed, quota_reset_at } = await getOrgQuota(client, orgId);
  // lazy monthly reset — if we're past the reset time, treat quota as fresh.
  if (new Date(quota_reset_at) <= new Date()) return;
  if (quota_used >= quota_allowed) {
    throw new HttpError(429, "organization usage quota exhausted for this period");
  }
}
