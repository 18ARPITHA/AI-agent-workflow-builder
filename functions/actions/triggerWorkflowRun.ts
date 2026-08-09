import type { Request, Response } from "express";
import { withTransaction } from "../lib/db";
import {
  parseActionPayload,
  requireOrgRole,
  verifyWebhookToken,
  assertQuotaAvailable,
  HttpError,
} from "../lib/permissions";
import { runWorkflow } from "../lib/executor";

// nhost/Hasura Functions use an Express-style (req, res) handler.
// This one backs the `triggerWorkflowRun(workflow_id)` Action described in
// the spec. It handles BOTH call paths:
//   1. A logged-in user clicking "Run" (manual trigger)      -> role: user
//   2. An external system hitting this Action unauthenticated
//      with a webhook_token                                   -> role: public
// (see hasura/metadata/actions.yaml — both roles are granted permission to
//  call the action; this handler is what actually gates access.)
export default async function handler(req: Request, res: Response) {
  try {
    const { input, sessionVariables } = parseActionPayload(req.body);
    const workflowId: string = input.workflow_id;
    const webhookToken: string | undefined = input.webhook_token;
    const userId = sessionVariables["x-hasura-user-id"];

    const result = await withTransaction(async (client) => {
      const { rows: wfRows } = await client.query(
        `select id, org_id, is_active from workflows where id = $1`,
        [workflowId]
      );
      const workflow = wfRows[0];
      if (!workflow) throw new HttpError(404, "workflow not found");
      if (!workflow.is_active) throw new HttpError(400, "workflow is not active");

      let triggerType: "manual" | "webhook" = "manual";
      let triggeredBy: string | null = null;

      if (userId) {
        // Path 1: logged-in user. Layer 1 — must be owner/editor in this org.
        await requireOrgRole(client, workflow.org_id, userId, ["owner", "editor"]);
        triggeredBy = userId;
        triggerType = "manual";
      } else {
        // Path 2: external caller via the webhook trigger. Ownership of the
        // *trigger config itself* (only an owner could have created it, per
        // the workflow_triggers permission) is what authorizes this call —
        // the token is the credential, there's no per-request user.
        await verifyWebhookToken(client, workflowId, webhookToken);
        triggerType = "webhook";
      }

      await assertQuotaAvailable(client, workflow.org_id);

      const { rows: runRows } = await client.query(
        `insert into workflow_runs (workflow_id, org_id, status, trigger_type, triggered_by)
           values ($1, $2, 'pending', $3, $4) returning id`,
        [workflowId, workflow.org_id, triggerType, triggeredBy]
      );
      const runId = runRows[0].id;

      const { rows: steps } = await client.query(
        `select id, step_order from workflow_steps where workflow_id = $1 order by step_order asc`,
        [workflowId]
      );
      if (steps.length === 0) throw new HttpError(400, "workflow has no steps");

      for (const step of steps) {
        await client.query(
          `insert into step_runs (workflow_run_id, workflow_step_id, step_order, status)
             values ($1, $2, $3, 'pending')`,
          [runId, step.id, step.step_order]
        );
      }

      const status = await runWorkflow(client, runId);
      return { run_id: runId, status };
    });

    res.status(200).json(result);
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ message: err?.message ?? "internal error" });
  }
}
