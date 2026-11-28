# The Build

A personal life-design dashboard — schedule, tasks, budget, and goal
tracking in one place, built to be actually usable day-to-day instead of
living in a chat history. Personal use and real team collaboration from
the start (see `WORKSPACES.md`), with an eventual App Store / web release
to other users as the goal.

## What this is

Six tabs:

- **Daily** — today's plan, merging Google Calendar, unscheduled tasks, and
  your known focus-time rhythm into one prioritized view
- **Calendar** — full month/week view with read/write Google Calendar
  access; tasks with a deadline or time slot get their own real calendar
  event automatically
- **To-Dos** — one unified hierarchy (Areas → Projects → Tasks →
  Subtasks, where each Area is a Life, Work, or Project Area) that works equally well for a quick grocery list or a fully
  structured initiative — a customizable Priority Ladder seeded from
  Maslow's hierarchy, and three interchangeable views (List, Kanban,
  Weekly Sprint)
- **Budget** — customizable cards (Income, Necessities, Subscriptions,
  Lifestyle, Business, Gap to Comfy), manual transaction entry for now with
  a documented path to bank sync later
- **Goals** — tally and target-based goals (camping trips, concerts, PIN
  membership milestones), tagged the same way as tasks
- **Journal** — dated reflection notes, plus a general-purpose AI agent
  that can create, edit, or delete tasks, budget cards, goals, and calendar
  events on request
- **Team collaboration** — any Area can be manually shared with a
  Workspace (multiple members, growing beyond one partner); shared Tasks
  support assignment, push notifications, and a shared agent conversation
  separate from your private one — see `WORKSPACES.md`
- **Clients & Invoicing** (hamburger menu, alongside Settings/Profile) —
  set flat or hourly contracts per engagement, log billable hours and
  agent token usage against them, and generate real invoices for external
  clients — see `CLIENTS-INVOICING.md`
- **Agent workers** — external agents (a dispatcher and a worker on the
  user's own machines) use the API as a task queue, post progress back to
  the task, and log token usage for billing — see `AGENT-WORKERS.md`

This isn't a generic budgeting or habit-tracking app — it's shaped around
one specific life, on purpose.

## Tech stack

- **Mobile client:** Expo (React Native + TypeScript) — `apps/mobile`
- **Web client:** Vite + React SPA, hosted on S3 + CloudFront — `apps/web`
- **Shared data layer:** `packages/shared-types` and `packages/api-client`
  — used by both apps, npm workspaces monorepo (no separate UI code shared
  between them; see `ARCHITECTURE.md`)
- **Backend:** API Gateway + Lambda (Express via `serverless-http`), CORS
  enabled for the web client
- **Database:** DynamoDB, single-table design
- **Auth:** Cognito, one user pool with separate app clients per platform
- **Storage:** S3 (exports, plus hosting the web app's static bundle)
- **AI agent:** Claude Haiku 4.5 via the Anthropic API, with tool-calling
  access to the app's own CRUD endpoints

Own standalone AWS stack — no shared infrastructure with other projects.

See [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the stack, repo structure,
deploy flow, and each tab's behavioral design. See
[`DATA-MODEL.md`](./docs/DATA-MODEL.md) for the full DynamoDB schema and API
endpoint list. See [`AGENT.md`](./docs/AGENT.md) for the Journal tab AI agent's
design. See [`WORKSPACES.md`](./docs/WORKSPACES.md) for team collaboration and
shared Areas. See [`CLIENTS-INVOICING.md`](./docs/CLIENTS-INVOICING.md)
for time tracking, contracts and invoicing. See
[`AGENT-WORKERS.md`](./docs/AGENT-WORKERS.md) for agent workers, delegated
access, and token budgets. See [`ROADMAP.md`](./docs/ROADMAP.md) for
potential, uncommitted additions. See [`CLAUDE.md`](./CLAUDE.md) for the
coding standards any Claude agent working in this repo should follow.

## Getting started

```bash
# install all workspace dependencies from the repo root
npm install

# run the mobile app
npm run dev --workspace=apps/mobile

# run the web app
npm run dev --workspace=apps/web
```

Backend infra is defined with **AWS CDK (TypeScript)** in `infra/`. See
`ARCHITECTURE.md` for the deploy flow.

## Repo flow

Feature branch → `stage` (test) → `main` (production), and every merge
triggers an automatic deploy. Claude merges its own feature PRs into
`stage` once the pre-merge checklist passes, except destructive or
hard-to-reverse changes, which wait for Elise. `stage` is promoted to
`main` only when Elise says "promote". Full workflow rules (branch naming,
PR base branch, pre-merge checklist, deploy rules, reporting): see
[`CLAUDE.md`](./CLAUDE.md).

## Status

Backend (`infra/`, `backend/`) is deployed to a `stage` AWS environment with the Priority Levels, Areas (life / work / project, at most one Work Area per project or task), Projects and Tasks routers plus `/health`, on the DynamoDB data-access layer. Requests are authenticated with a Cognito user pool authorizer, and agent workers can act on a user's data through delegated access (`AGENT-WORKERS.md`). Production runs the same foundation stack. `stage` deploys from GitHub Actions on push to `stage`, and `prod` on push to `main`, both through OIDC. Design is complete for all six tabs plus team collaboration. Agent workers can claim queued tasks, heartbeat, and post progress updates. Designed but not yet implemented: Clients, Contracts and time entries with agent token usage, and agent usage logging and token budgets (`AGENT-WORKERS.md`). `apps/mobile` and `apps/web` have not been scaffolded yet. See "Open questions" in `ARCHITECTURE.md` and `DATA-MODEL.md` for outstanding decisions.