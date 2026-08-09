import type { Request, Response } from "express";
import { withTransaction } from "../lib/db";
import { parseActionPayload, getOrgRole, HttpError } from "../lib/permissions";
import { runWorkflow } from "../lib/executor";

// Backs `approveStep(step_run_id, approve)`. This is the one decision in the
// whole system that a static Hasura row permission genuinely cannot make:
// whether THIS step_run may resume depends on the caller's role in that
// specific org, checked at the moment of approval — not on any column of
// the row being written. So step_runs has no update permission for role
// "user" at all, and this handler is the only path that can move a paused
// run forward.
export default async function handler(req: Request, res: Response) {
  try {
    const { input, sessionVariables } = parseActionPayload(req.body);
    const stepRunId: string = input.step_run_id;
    const approve: boolean = input.approve;
    const userId = sessionVariables["x-hasura-user-id"];
    if (!userId) throw new HttpError(401, "must be logged in to approve a step");

    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `select sr.id, sr.status, sr.workflow_run_id, ws.config as step_config,
                wr.org_id
           from step_runs sr
           join workflow_steps ws on ws.id = sr.workflow_step_id
           join workflow_runs wr on wr.id = sr.workflow_run_id
          where sr.id = $1
          for update of sr`,
        [stepRunId]
      );
      const stepRun = rows[0];
      if (!stepRun) throw new HttpError(404, "step run not found");
      if (stepRun.status !== "paused") {
        throw new HttpError(400, `step run is not awaiting approval (status: ${stepRun.status})`);
      }

      const requiredRole = stepRun.step_config?.required_role;
      const allowed: string[] = requiredRole ? [requiredRole] : ["owner", "editor"];
      const role = await getOrgRole(client, stepRun.org_id, userId);
      if (!role || !allowed.includes(role)) {
        throw new HttpError(403, `requires role ${allowed.join("/")} in this organization to approve`);
      }

      if (!approve) {
        await client.query(
          `update step_runs set status = 'failed', error = 'rejected by approver',
                  approved_by = $2, approved_at = now(), finished_at = now()
             where id = $1`,
          [stepRunId, userId]
        );
        await client.query(
          `update workflow_runs set status = 'failed', error = 'approval rejected', finished_at = now()
             where id = $1`,
          [stepRun.workflow_run_id]
        );
        return { step_run_id: stepRunId, run_status: "failed" };
      }

      await client.query(
        `update step_runs set status = 'succeeded', approved_by = $2, approved_at = now(), finished_at = now(),
                output = '{"approved": true}'::jsonb
           where id = $1`,
        [stepRunId, userId]
      );

      const finalStatus = await runWorkflow(client, stepRun.workflow_run_id);
      return { step_run_id: stepRunId, run_status: finalStatus };
    });

    res.status(200).json(result);
  } catch (err: any) {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ message: err?.message ?? "internal error" });
  }
}
