# AI Agent Workflow Builder

A mini n8n for chaining AI agent steps, built on nhost (Postgres + Hasura +
Auth) with a Next.js frontend. See `WRITEUP.md` for the design reasoning
(schema, the two permission layers, approval-gate pause/resume).

## Repo layout

```
db/migrations/       Postgres schema (organizations → workflows → steps/triggers → runs → step_runs)
hasura/metadata/      Tables, relationships, permissions (Layer 1 + static Layer 2), Actions, event triggers, cron
functions/            nhost Functions: Action handlers, event-trigger handlers, scheduled runner
scripts/seed.ts       Seeds the two-org demo scenario used in the Final Task
frontend/              Next.js app (auth, workflow builder, live run view, quota indicator)
```

## Prerequisites

- Node 18+
- Docker (for local nhost/Postgres/Hasura via the nhost CLI)
- `npm i -g nhost` (nhost CLI)
- An LLM API key from a free tier (Groq, OpenRouter, or Gemini) — **optional**.
  Without one, `llm_call` steps run with `LLM_STUB=true` automatically: a
  clearly-labelled stub response with a disclosed 800ms artificial delay,
  so the rest of the system (retries, branching, subscriptions) is fully
  demoable without any external account.

## Local setup

```bash
git clone <this-repo>
cd workflow-builder

cp .secrets.example .secrets            # fill in real values
cp functions/.env.example functions/.env
cp frontend/.env.example frontend/.env.local

nhost up                                 # starts local Postgres + Hasura + Auth + Functions
                                          # applies db/migrations and hasura/metadata automatically

cd functions && npm install && cd ..
cd frontend && npm install && npm run dev
```

The frontend runs at `http://localhost:3000`, the local Hasura console at
`http://localhost:1337` (per nhost's default local ports).

## Seeding the demo scenario

```bash
NHOST_BACKEND_URL=http://localhost:1337 HASURA_ADMIN_SECRET=nhost-admin-secret \
  npx ts-node scripts/seed.ts
```

This creates **Org A** (owner-a@example.com / editor-a@example.com) and
**Org B** (owner-b@example.com), all with password `Passw0rd!2026`, and is
exactly the setup the Final Task walkthrough (see `WRITEUP.md`) assumes.

## Environment variables that matter

| Variable | Where | Purpose |
|---|---|---|
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_STUB` | `functions/.env` | Real vs stubbed `llm_call` |
| `SLACK_WEBHOOK_URL` / `EMAIL_API_KEY` | `functions/.env` | `notify` step delivery (falls back to a console-log stub) |
| `ACTIONS_WEBHOOK_SECRET` | `.secrets` + `functions/.env` | Shared secret between Hasura and the function handlers |
| `NEXT_PUBLIC_NHOST_SUBDOMAIN/REGION` | `frontend/.env.local` | Points the frontend at your nhost project |

## Deploying

1. Create a project at nhost.io, push this repo, connect it (or `nhost deploy`).
2. Set the same env vars from `.secrets`/`functions/.env` in the nhost dashboard.
3. Deploy `frontend/` to Vercel, pointing `NEXT_PUBLIC_NHOST_SUBDOMAIN`/`NEXT_PUBLIC_NHOST_REGION`
   at the hosted nhost project.
4. Re-run `scripts/seed.ts` against the hosted `NHOST_BACKEND_URL`.

## What's stubbed vs real

- **LLM calls**: real (Groq/OpenRouter/Gemini) if `LLM_API_KEY` is set; otherwise a
  disclosed, delayed stub — see `functions/lib/llm.ts`.
- **HTTP steps**: always real (`fetch` against whatever `url` the step config gives).
- **Notify (Slack/email)**: real if `SLACK_WEBHOOK_URL`/`EMAIL_API_KEY` is set; otherwise
  logs to console — see `functions/events/notify.ts`.
- **Scheduled trigger**: real cron matching (`functions/lib/cronMatch.ts`) driven by a
  single Hasura `cron_trigger` that ticks every minute (see `WRITEUP.md` for why).

## Known limitations / what I'd do next with more time

- The executor runs synchronously inside the Action HTTP request. That's fine for a
  demo (subscriptions still update live because they read the DB independently of the
  Action's response), but a production version should hand execution to a queue/worker
  so long-running workflows don't fight Action timeouts.
- `conditional_branch` targets are step_order integers set by the workflow author,
  not step IDs — simpler to author by hand for the demo, but a real UI would let you
  point-and-click the branch target and store the step id instead.
- No optimistic-concurrency handling if two people edit the same workflow's steps at
  once (last write wins).
