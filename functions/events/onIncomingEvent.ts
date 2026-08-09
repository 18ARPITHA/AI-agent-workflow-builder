import type { Request, Response } from "express";
import { withTransaction } from "../lib/db";
import { assertQuotaAvailable } from "../lib/permissions";
import { runWorkflow } from "../lib/executor";

// Backs the `database_event` trigger type. Configured on the `incoming_events`
// table (insert) in hasura/metadata — see the incoming_event_trigger
// event_trigger. Any row inserted there is a candidate to auto-start every
// workflow in the same org whose workflow_triggers row is
// { type: 'database_event', config: { watched_table: 'incoming_events' } }.
//
// This runs with the same admin authority as the Action handlers — a row
// change, not a logged-in user, is what's authorizing the run here, which
// is why workflow_triggers of this type are still gated at creation time
// (Layer 1/2, editor+ only) but not re-checked per-firing.
export default async function handler(req: Request, res: Response) {
  try {
    const row = req.body?.event?.data?.new;
    if (!row) return res.status(200).json({ skipped: true });

    await withTransaction(async (client) => {
      await assertQuotaAvailable(client, row.org_id);

      const { rows: triggers } = await client.query(
        `select wt.workflow_id
           from workflow_triggers wt
           join workflows w on w.id = wt.workflow_id
          where wt.type = 'database_event'
            and wt.is_enabled = true
            and wt.config->>'watched_table' = 'incoming_events'
            and w.org_id = $1
            and w.is_active = true`,
        [row.org_id]
      );

      for (const t of triggers) {
        const { rows: steps } = await client.query(
          `select id, step_order from workflow_steps where workflow_id = $1 order by step_order asc`,
          [t.workflow_id]
        );
        if (steps.length === 0) continue;

        const { rows: runRows } = await client.query(
          `insert into workflow_runs (workflow_id, org_id, status, trigger_type, triggered_by)
             values ($1, $2, 'pending', 'database_event', null) returning id`,
          [t.workflow_id, row.org_id]
        );
        const runId = runRows[0].id;

        for (const step of steps) {
          await client.query(
            `insert into step_runs (workflow_run_id, workflow_step_id, step_order, status)
               values ($1, $2, $3, 'pending')`,
            [runId, step.id, step.step_order]
          );
        }

        await runWorkflow(client, runId);
      }
    });

    res.status(200).json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message ?? "db event handler error" });
  }
}
