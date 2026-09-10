# The Build

A personal life-design dashboard — schedule, tasks, budget, and goal
tracking in one place, built as a mobile app so it's actually usable
day-to-day instead of living in a chat history. Designed for personal use
first, with an eventual App Store release to other users as the goal.

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

This isn't a generic budgeting or habit-tracking app — it's shaped around
one specific life, on purpose.

## Tech stack

- **Client:** Expo (React Native + TypeScript)
- **Backend:** API Gateway + Lambda (Express via `serverless-http`)
- **Database:** DynamoDB, single-table design
- **Auth:** Cognito
- **Storage:** S3 (exports only — PDF/CSV snapshots, not core data)
- **AI agent:** Claude via the Anthropic API, with tool-calling access to
  the app's own CRUD endpoints

Own standalone AWS stack — no shared infrastructure with other projects.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the stack, deploy
flow, and each tab's behavioral design. See
[`docs/DATA-MODEL.md`](./docs/DATA-MODEL.md) for the full DynamoDB schema
and API endpoint list. See [`docs/AGENT.md`](./docs/AGENT.md) for the
Journal tab AI agent's design. See [`docs/CLAUDE.md`](./docs/CLAUDE.md)
for the coding standards any Claude agent working in this repo should
follow.

## Getting started

```bash
# install dependencies
npm install

# start the Expo dev server
npx expo start
```

Backend infra is defined with **AWS CDK (TypeScript)**. CDK setup and
deploy instructions to be added once the backend is scaffolded.

## Repo flow

- Work happens on feature/working branches
- Manual merge: feature branch → `stage` (test) → `main` (production)
- No automated or agent-initiated merges into `stage` or `main`

## Status

Design phase complete for all six tabs. Several open questions remain
(see the "Open questions" sections in `ARCHITECTURE.md` and
`DATA-MODEL.md`) before implementation starts. No code written yet.