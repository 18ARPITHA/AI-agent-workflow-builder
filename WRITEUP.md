# Design write-up

## Schema reasoning

The chain is `organizations → org_members → workflows → workflow_steps /
workflow_triggers → workflow_runs → step_runs`, matching the assignment's
relationship requirement exactly. A few deliberate choices:

- **`org_members` is the single source of truth for role**, not a Hasura
  role. A user's role is per-organization (owner in Org A, viewer in Org
  B), and Hasura roles are global to a request — they can't represent
  that. So every human user gets one Hasura role, `"user"`, and every
  permission rule traverses `workflow → org → org_members` to check the
  caller's role *for that specific org*. This is what makes cross-org
  isolation airtight: even a global "owner" claim is meaningless without
  an `org_members` row for that exact org, so guessing another org's
  workflow ID returns nothing rather than a permission error (the row
  filter simply excludes it).
- **`workflow_runs` / `step_runs` have zero Hasura permissions for role
  `"user"`** — no select-only-not-write, *no permission object at all*
  for insert/update. They're written exclusively by the Action handlers
  and event/cron functions, which connect with the Postgres admin
  connection string. This means there is no GraphQL mutation a user could
  call, however cleverly, to fake a run's status, skip a step, or forge
  an approval — the only door in is the Action, and the Action checks
  identity in code before it writes anything.
- **`workflow_results`** is a generic sink for `db_write` steps rather
  than writing into arbitrary user-named tables, which keeps permissions
  and the demo tractable without losing the "saves into your own tables"
  requirement.
- **`incoming_events`** exists because Hasura Event Triggers are
  configured statically per table at deploy time — there's no way to
  attach one dynamically per-workflow. So the *database_event* trigger
  type is demonstrated against this one watched table, and
  `workflow_triggers.config.watched_table` plus the org_id on the new row
  is what the event handler uses to fan out to the right workflows. A
  real system watching arbitrary user tables would need per-table event
  triggers provisioned via the Hasura metadata API when a trigger is
  created — noted as a known limitation.

## The two permission layers, enforced differently

**Layer 1 (org + role scoping)** is enforced as *static Hasura row
permissions* on `workflows`, `workflow_steps`, `workflow_triggers`, and
`org_members` — a boolean expression Hasura evaluates against Postgres on
every query/mutation, before any application code runs. This is the
right layer for it: "can this user see/edit this row" is fully knowable
from the row's own foreign keys plus the `org_members` table, so it
belongs in the database's permission system, not in a service.

**Layer 2 (step-level gating)** splits into two enforcement mechanisms
depending on whether the decision is static or a state transition:

- *Static* cases — creating a `db_write`/`notify` step, or a `webhook`
  trigger — are still expressible as a row permission, because the
  restriction depends only on a column of the row being written (`type`)
  plus the same org/role check. These are folded into the same Hasura
  permission rules as Layer 1 (see the `_or` conditions in
  `hasura/metadata/databases/default/tables/tables.yaml`).
- *Dynamic* cases — resuming a paused `approval_gate`, and the
  owner/editor + quota checks inside `triggerWorkflowRun` — are **not**
  expressible as a row permission, because they're a decision made *at
  the moment of the call* about a row that already exists in a specific
  state (`paused`), not about who's allowed to own or read the row in
  general. These are enforced explicitly in the Action handler code
  (`functions/actions/approveStep.ts`, `functions/actions/
  triggerWorkflowRun.ts`) using the same `org_members` lookup, just done
  in TypeScript instead of a Postgres boolean expression — which is also
  exactly why `step_runs`/`workflow_runs` have no direct-write permission
  at all: it forces every mutation of run state through that checked code
  path.

## Approval-gate pause/resume

`triggerWorkflowRun` creates the `workflow_run` and one `step_runs` row
per step upfront (all `pending`), then runs `functions/lib/executor.ts`'s
`runWorkflow()` synchronously inside the same request, advancing
step-by-step. When it reaches an `approval_gate` step, it sets that
`step_run` and the parent `workflow_run` to `paused` and **returns**
immediately — the Action's HTTP response comes back with
`status: "paused"`, and nothing further happens until someone calls
`approveStep`.

`approveStep` re-checks that the target `step_run` is still `paused`
(guards against double-approval races), checks the caller's role against
the gate's `required_role` (or `owner`/`editor` by default), marks the
gate step `succeeded` or `failed`, and — on approval — calls the exact
same `runWorkflow()` function again, which picks up at the first
`pending` step_run and continues to completion, the next gate, or a
failure. Both entry points share one executor so "start" and "resume"
can't drift into different behavior.

The frontend never polls for this: `RunView` holds a GraphQL
*subscription* on `step_runs` filtered by `workflow_run_id`. Because the
executor commits each step's status via a normal SQL `UPDATE` inside a
transaction, and the subscription is a live query against that same
table, the UI updates in real time as the (still-running) Action request
writes each row — including the `paused` state — with no page refresh
and no relation to whether the Action's own HTTP response has completed.
