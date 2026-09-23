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
- **To-Dos** — one unified hierarchy (Life Areas → Projects → Tasks →
  Subtasks) that works equally well for a quick grocery list or a fully
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
- **Team collaboration** — any Life Area can be manually shared with a
  Workspace (multiple members, growing beyond one partner); shared Tasks
  support assignment, push notifications, and a shared agent conversation
  separate from your private one — see `WORKSPACES.md`

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

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the stack, repo structure,
deploy flow, and each tab's behavioral design. See
[`DATA-MODEL.md`](./DATA-MODEL.md) for the full DynamoDB schema and API
endpoint list. See [`AGENT.md`](./AGENT.md) for the Journal tab AI agent's
design. See [`WORKSPACES.md`](./WORKSPACES.md) for team collaboration and
shared Life Areas. See [`CLAUDE.md`](./CLAUDE.md) for the coding standards
any Claude agent working in this repo should follow.

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

- Work happens on feature/working branches
- Manual merge: feature branch → `stage` (test) → `main` (production)
- No automated or agent-initiated merges into `stage` or `main`

## Status

Backend (`infra/`, `backend/`) is live on a `stage` AWS environment — one
resource router (`/health`) implemented, DynamoDB data-access layer built
and verified against the real deployed table. Design is complete for all
six tabs plus team collaboration. `apps/mobile` and `apps/web` have not
been scaffolded yet. See "Open questions" in `ARCHITECTURE.md` and
`DATA-MODEL.md` for outstanding decisions.