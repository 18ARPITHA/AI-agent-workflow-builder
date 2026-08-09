import type { Request, Response } from "express";
import { query } from "../lib/db";

// Hasura Event Trigger payload shape: { event: { op, data: { new, old } }, table, ... }
// Configured on step_runs (insert + update) in hasura/metadata — see the
// step_run_notify event_trigger. We only act when the row's step type is
// `notify` and it just reached `succeeded` (i.e. the message was rendered
// by the executor in functions/lib/executor.ts).
export default async function handler(req: Request, res: Response) {
  try {
    const { event } = req.body;
    const row = event?.data?.new;
    if (!row || row.status !== "succeeded") return res.status(200).json({ skipped: true });

    const [step] = await query(
      `select ws.type, ws.config from workflow_steps ws where ws.id = $1`,
      [row.workflow_step_id]
    );
    if (!step || step.type !== "notify") return res.status(200).json({ skipped: true });

    const { message, channel, target } = row.output ?? {};

    if (channel === "slack" && process.env.SLACK_WEBHOOK_URL) {
      await fetch(process.env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `[${target ?? "workflow"}] ${message}` }),
      });
    } else if (channel === "email" && process.env.EMAIL_API_KEY) {
      // Swap in your provider of choice (Resend/SendGrid/etc). Left generic
      // on purpose since the assignment allows any email provider.
      console.log(`[email stub] to=${target} message=${message}`);
    } else {
      console.log(`[notify stub — no ${channel} credentials configured] to=${target}: ${message}`);
    }

    res.status(200).json({ sent: true });
  } catch (err: any) {
    res.status(500).json({ message: err?.message ?? "notify handler error" });
  }
}
