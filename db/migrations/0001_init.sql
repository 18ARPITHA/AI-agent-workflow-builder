-- AI Agent Workflow Builder — core schema
-- Postgres 14+ (nhost default). Run via `hasura migrate apply` or psql.

create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────────────
-- Orgs & membership
-- ─────────────────────────────────────────────────────────────────────────

create table organizations (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  quota_period    text not null default 'monthly',        -- 'monthly' is the only period implemented
  quota_allowed   integer not null default 1000,           -- calls allowed per period
  quota_used      integer not null default 0,              -- calls used in current period
  quota_reset_at  timestamptz not null default date_trunc('month', now()) + interval '1 month',
  created_at      timestamptz not null default now()
);

create type org_role as enum ('owner', 'editor', 'viewer');

create table org_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        org_role not null default 'viewer',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);

create index idx_org_members_user on org_members(user_id);
create index idx_org_members_org on org_members(org_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Workflows
-- ─────────────────────────────────────────────────────────────────────────

create table workflows (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_workflows_org on workflows(org_id);

create type step_type as enum (
  'llm_call', 'http_request', 'db_write', 'notify', 'conditional_branch', 'approval_gate'
);

create table workflow_steps (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  step_order  integer not null,
  type        step_type not null,
  name        text not null,
  config      jsonb not null default '{}'::jsonb,
  -- config shape per type, informally:
  --   llm_call:            { prompt_template, model, max_tokens }
  --   http_request:        { method, url, headers, body_template }
  --   db_write:            { table, column_map }
  --   notify:              { channel: 'slack'|'email', target, message_template }
  --   conditional_branch:  { condition: jsonpath/expr, on_true_next, on_false_next }
  --   approval_gate:       { required_role: 'owner'|'editor', message }
  created_at  timestamptz not null default now(),
  unique (workflow_id, step_order)
);

create index idx_workflow_steps_workflow on workflow_steps(workflow_id);

create type trigger_type as enum ('manual', 'webhook', 'scheduled', 'database_event');

create table workflow_triggers (
  id          uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id) on delete cascade,
  type        trigger_type not null,
  config      jsonb not null default '{}'::jsonb,
  -- config shape per type:
  --   manual:          {}
  --   webhook:         { webhook_token }               -- bearer token checked in the Action handler
  --   scheduled:       { cron }                          -- e.g. "*/15 * * * *"
  --   database_event:  { watched_table, watched_schema } -- row insert/update auto-starts a run
  is_enabled  boolean not null default true,
  created_at  timestamptz not null default now()
);

create index idx_workflow_triggers_workflow on workflow_triggers(workflow_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Runs
-- ─────────────────────────────────────────────────────────────────────────

create type run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled');

create table workflow_runs (
  id            uuid primary key default gen_random_uuid(),
  workflow_id   uuid not null references workflows(id) on delete cascade,
  org_id        uuid not null references organizations(id) on delete cascade,
  status        run_status not null default 'pending',
  trigger_type  trigger_type not null,
  triggered_by  uuid references auth.users(id),          -- null for webhook/scheduled/db-event
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error         text
);

create index idx_workflow_runs_workflow on workflow_runs(workflow_id);
create index idx_workflow_runs_org on workflow_runs(org_id);

create type step_run_status as enum ('pending', 'running', 'paused', 'succeeded', 'failed', 'skipped');

create table step_runs (
  id              uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  workflow_step_id uuid not null references workflow_steps(id) on delete cascade,
  step_order      integer not null,
  status          step_run_status not null default 'pending',
  input           jsonb,
  output          jsonb,
  error           text,
  attempt_count   integer not null default 0,
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz
);

create index idx_step_runs_run on step_runs(workflow_run_id);

-- ─────────────────────────────────────────────────────────────────────────
-- Aggregation: org usage this month + average run duration (Postgres view)
-- ─────────────────────────────────────────────────────────────────────────

create view org_usage_stats as
select
  o.id as org_id,
  o.quota_allowed,
  o.quota_used,
  o.quota_reset_at,
  count(wr.id) filter (
    where wr.started_at >= date_trunc('month', now())
  ) as runs_this_month,
  avg(extract(epoch from (wr.finished_at - wr.started_at)))
    filter (where wr.finished_at is not null) as avg_run_duration_seconds
from organizations o
left join workflow_runs wr on wr.org_id = o.id
group by o.id, o.quota_allowed, o.quota_used, o.quota_reset_at;

-- updated_at bookkeeping for workflows
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_workflows_updated_at
  before update on workflows
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Demo table for the "database event" trigger type. Hasura Event Triggers
-- are configured statically per table, so the trigger type is demonstrated
-- against this one watched table; workflow_triggers.config.watched_table
-- records which table+workflow pair should react (checked in the event
-- handler function, see functions/events/onIncomingEvent.ts).
-- ─────────────────────────────────────────────────────────────────────────

create table incoming_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  source      text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index idx_incoming_events_org on incoming_events(org_id);

-- Generic sink for db_write steps.
create table workflow_results (
  id              uuid primary key default gen_random_uuid(),
  workflow_run_id uuid not null references workflow_runs(id) on delete cascade,
  step_run_id     uuid not null references step_runs(id) on delete cascade,
  org_id          uuid not null references organizations(id) on delete cascade,
  data            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index idx_workflow_results_run on workflow_results(workflow_run_id);
