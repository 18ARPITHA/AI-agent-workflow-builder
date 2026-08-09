import type { Request, Response } from "express";
import { withTransaction } from "../lib/db";
import { assertQuotaAvailable } from "../lib/permissions";
import { runWorkflow } from "../lib/executor";
// lightweight cron matcher — avoids pulling in a full cron library for 5 fields
import cronMatches from "../lib/cronMatch";

// Backs the `scheduled` trigger type. hasura/metadata/cron_triggers.yaml
// calls this every minute; it looks at every enabled workflow_triggers row
// of type 'scheduled' and starts a run for any whose own config.cron
// expression matches the current minute. This is what lets each workflow
// have an independent schedule without one static Hasura cron_trigger per
// workflow (Hasura cron triggers can't be created dynamically at runtime).
export default async function handler(req: Request, res: Response) {
  try {
    const now = new Date();
    const started: string[] = [];

    await withTransaction(async (client) => {
      const { rows: triggers } = await client.query(
        `select wt.workflow_id, wt.config, w.org_id, w.is_active
           from workflow_triggers wt
           join workflows w on w.id = wt.workflow_id
          where wt.type = 'scheduled' and wt.is_enabled = true`
      );

      for (const t of triggers) {
        if (!t.is_active) continue;
        if (!cronMatches(t.config?.cron, now)) continue;

        try {
          await assertQuotaAvailable(client, t.org_id);
        } catch {
          continue; // quota exhausted — skip this org's scheduled run silently, don't fail the whole tick
        }

        const { rows: steps } = await client.query(
          `select id, step_order from workflow_steps where workflow_id = $1 order by step_order asc`,
          [t.workflow_id]
        );
        if (steps.length === 0) continue;

        const { rows: runRows } = await client.query(
          `insert into workflow_runs (workflow_id, org_id, status, trigger_type, triggered_by)
             values ($1, $2, 'pending', 'scheduled', null) returning id`,
          [t.workflow_id, t.org_id]
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
        started.push(runId);
      }
    });

    res.status(200).json({ started_runs: started });
  } catch (err: any) {
    res.status(500).json({ message: err?.message ?? "cron runner error" });
  }
}
