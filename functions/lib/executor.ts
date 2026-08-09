import { PoolClient } from "pg";
import { callLLM, callHttp, renderTemplate } from "./llm";

interface StepRow {
  id: string; // workflow_steps.id
  step_order: number;
  type: string;
  name: string;
  config: any;
}

interface StepRunRow {
  id: string;
  workflow_step_id: string;
  step_order: number;
  status: string;
}

function evaluateCondition(condition: any, previousOutput: any): boolean {
  if (!condition) return true;
  const value = (condition.path as string)
    .split(".")
    .reduce((acc: any, key: string) => acc?.[key], previousOutput);
  switch (condition.op) {
    case "eq":
      return value === condition.value;
    case "neq":
      return value !== condition.value;
    case "contains":
      return typeof value === "string" && value.includes(condition.value);
    case "exists":
      return value !== undefined && value !== null;
    case "gt":
      return Number(value) > Number(condition.value);
    case "lt":
      return Number(value) < Number(condition.value);
    default:
      return Boolean(value);
  }
}

/** Runs (or resumes) a workflow_run to completion, to a failure, or to the
 *  next approval_gate pause point. Returns the run's final status. */
export async function runWorkflow(client: PoolClient, runId: string): Promise<string> {
  const { rows: runRows } = await client.query(
    `select id, workflow_id, org_id, status from workflow_runs where id = $1 for update`,
    [runId]
  );
  const run = runRows[0];
  if (!run) throw new Error("run not found");
  if (run.status === "succeeded" || run.status === "failed" || run.status === "cancelled") {
    return run.status;
  }

  const steps: StepRow[] = (
    await client.query(
      `select id, step_order, type, name, config from workflow_steps
         where workflow_id = $1 order by step_order asc`,
      [run.workflow_id]
    )
  ).rows;

  const stepRuns: StepRunRow[] = (
    await client.query(
      `select id, workflow_step_id, step_order, status from step_runs
         where workflow_run_id = $1 order by step_order asc`,
      [runId]
    )
  ).rows;

  const stepById = new Map(steps.map((s) => [s.id, s]));
  const stepRunByOrder = new Map(stepRuns.map((sr) => [sr.step_order, sr]));

  await client.query(`update workflow_runs set status = 'running' where id = $1`, [runId]);

  // context accumulates each step's output, keyed by step name, plus
  // `previous_output` for the immediately preceding step — used for
  // {{templating}} in llm_call / http_request / conditional_branch configs.
  let previousOutput: any = {};
  const byName: Record<string, any> = {};
  // seed context with any already-succeeded steps (covers resume-after-approval)
  for (const s of steps) {
    const sr = stepRunByOrder.get(s.step_order);
    if (sr?.status === "succeeded") {
      const full = (await client.query(`select output from step_runs where id = $1`, [sr.id])).rows[0];
      byName[s.name] = full?.output;
      previousOutput = full?.output ?? previousOutput;
    }
  }

  let currentOrder = steps.find((s) => stepRunByOrder.get(s.step_order)?.status === "pending")?.step_order;

  while (currentOrder !== undefined) {
    const step = steps.find((s) => s.step_order === currentOrder)!;
    const stepRun = stepRunByOrder.get(currentOrder)!;
    const context = { previous_output: previousOutput, steps: byName };

    await client.query(
      `update step_runs set status = 'running', started_at = now(), input = $2 where id = $1`,
      [stepRun.id, JSON.stringify(context)]
    );

    try {
      let output: any = null;
      let attempts = 0;

      switch (step.type) {
        case "llm_call": {
          attempts = 1;
          const prompt = renderTemplate(step.config.prompt_template ?? "", context);
          const result = await callLLM(prompt, step.config.model);
          output = { text: result.text, model: result.model, stubbed: result.stubbed };
          break;
        }
        case "http_request": {
          attempts = 1;
          const url = renderTemplate(step.config.url ?? "", context);
          const body = step.config.body_template
            ? JSON.parse(renderTemplate(JSON.stringify(step.config.body_template), context))
            : undefined;
          const result = await callHttp(step.config.method ?? "GET", url, step.config.headers ?? {}, body);
          output = result;
          break;
        }
        case "db_write": {
          attempts = 1;
          await client.query(
            `insert into workflow_results (workflow_run_id, step_run_id, org_id, data)
               values ($1, $2, $3, $4)`,
            [runId, stepRun.id, run.org_id, JSON.stringify(previousOutput)]
          );
          output = { saved: true };
          break;
        }
        case "notify": {
          attempts = 1;
          // The actual send happens in the step_run_notify Event Trigger,
          // which fires on this very row write. This step just prepares
          // the message so the event handler has something ready to use.
          output = {
            message: renderTemplate(step.config.message_template ?? "", context),
            channel: step.config.channel ?? "slack",
            target: step.config.target,
          };
          break;
        }
        case "conditional_branch": {
          attempts = 1;
          const branchResult = evaluateCondition(step.config.condition, previousOutput);
          output = { branch: branchResult };
          const nextOrder = branchResult ? step.config.on_true_next : step.config.on_false_next;
          await client.query(
            `update step_runs set status = 'succeeded', output = $2, attempt_count = $3, finished_at = now()
               where id = $1`,
            [stepRun.id, JSON.stringify(output), attempts]
          );
          byName[step.name] = output;
          previousOutput = output;

          // skip every step strictly between here and the chosen branch target
          const target = nextOrder ?? step.step_order + 1;
          for (const s of steps) {
            if (s.step_order > step.step_order && s.step_order < target) {
              const sr = stepRunByOrder.get(s.step_order);
              if (sr) {
                await client.query(
                  `update step_runs set status = 'skipped', finished_at = now() where id = $1`,
                  [sr.id]
                );
              }
            }
          }
          currentOrder = steps.find((s) => s.step_order === target)?.step_order;
          continue; // already wrote this step_run; skip the generic success write below
        }
        case "approval_gate": {
          await client.query(
            `update step_runs set status = 'paused', started_at = coalesce(started_at, now()) where id = $1`,
            [stepRun.id]
          );
          await client.query(`update workflow_runs set status = 'paused' where id = $1`, [runId]);
          return "paused"; // stop here — approveStep resumes execution later
        }
        default:
          throw new Error(`unknown step type: ${step.type}`);
      }

      await client.query(
        `update step_runs set status = 'succeeded', output = $2, attempt_count = $3, finished_at = now()
           where id = $1`,
        [stepRun.id, JSON.stringify(output), attempts]
      );
      byName[step.name] = output;
      previousOutput = output;

      const next = steps.find((s) => s.step_order === currentOrder! + 1);
      currentOrder = next?.step_order;
    } catch (err: any) {
      await client.query(
        `update step_runs set status = 'failed', error = $2, attempt_count = attempt_count + 1, finished_at = now()
           where id = $1`,
        [stepRun.id, String(err?.message ?? err)]
      );
      await client.query(
        `update workflow_runs set status = 'failed', error = $2, finished_at = now() where id = $1`,
        [runId, String(err?.message ?? err)]
      );
      return "failed";
    }
  }

  await client.query(
    `update workflow_runs set status = 'succeeded', finished_at = now() where id = $1`,
    [runId]
  );
  await client.query(
    `update organizations set quota_used = quota_used + 1 where id = $1`,
    [run.org_id]
  );
  return "succeeded";
}
