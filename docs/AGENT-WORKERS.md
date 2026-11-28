# Agent Workers

External agent workers use this API as their task store and work queue.
Today that means the user's "second brain" setup: a dispatcher (moving to
an always-on Raspberry Pi) that sorts new tasks, and a worker on a Mac
that runs agent work (Claude now, local Ollama models later) and writes
progress and usage back.

This is separate from the Journal tab agent in `AGENT.md`, which runs
inside the backend. Workers run outside AWS and reach the API over HTTPS
like any client.

Implemented: the agent app client and delegated access, for the routers
that exist so far (`/tasks`, `/life-areas`, `/projects`,
`/priority-levels`). Not yet implemented: everything else in this doc.

## Service user and delegated access

Every route stores data under the caller's Cognito `sub` (`USER#<sub>`).
A worker logging in as its own user would read and write an empty
partition, so a worker acts **on behalf of** a user through delegation.

- **Service user.** A dedicated Cognito user in the existing pool, one per
  human owner, created once with `aws cognito-idp admin-create-user`
  rather than through self-sign-up. It owns no data of its own.
- **Agent app client.** A third app client on the user pool, alongside
  mobile and web, for workers only. It is a confidential client with a
  secret (workers run on machines the user controls, unlike a phone app)
  and allows `USER_PASSWORD_AUTH` plus refresh tokens. Its access tokens
  carry the same `aws.cognito.signin.user.admin` scope the API Gateway
  authorizer already requires, so the authorizer is unchanged.
- **Delegation record.** `PK: USER#<ownerId>`, `SK: DELEGATE#<serviceSub>`
  grants that service user access to the owner's data. Created once, by
  a one-off `put-item`; there is no endpoint for it.
- **Acting as the owner.** The worker sends `X-Act-As-User: <ownerId>`.
  The auth middleware (`auth/current-user.ts`) checks for the delegation
  record. If it exists, `req.userId` is the owner and `req.actorUserId` is
  the service user; if not, the request gets 403. The header is only
  trusted alongside a verified token and a matching delegation record —
  on its own it grants nothing. Without the header, `req.actorUserId`
  equals `req.userId`.
- **Revoking.** Delete the delegation record, or disable the service user
  in Cognito.

### What a delegate can call

Delegated requests are limited to an allowlist. Everything else returns
403, so a misbehaving local model can't touch budget, journal, calendar or
settings data.

| Route | Allowed |
|---|---|
| `/tasks` | GET, POST, PUT, claim, heartbeat, updates. Not DELETE |
| `/time-entries` | GET, POST (`actorType` is forced to `agent`) |
| `/usage/summary`, `/usage/budget` | GET |
| `/areas`, `/projects`, `/priority-levels`, `/clients`, `/contracts` | GET |

Every write records `req.actorUserId` (`TASK.createdBy`,
`TASK_UPDATE.actorUserId`), so agent changes are distinguishable from the
user's own.

## Task lifecycle

```
phone / web / email ─► Unsorted ─► dispatcher sorts ─► To Do / Backlog
                                        │
                                        └─ agent work? agentState: queued
                                              │
                         worker claims ─► claimed ─► running
                                              │
                               needs_review / done / failed
```

- **Unsorted.** New tasks from the phone (and later email, see
  `ROADMAP.md`) arrive with status `Unsorted` and a `source`. The
  dispatcher sets `areaIds` and `projectId`, moves the status to `To Do`
  or `Backlog`, and sets `agentState: queued` when the task is agent work.
- **`agentState`** is separate from `status`, so the user's Kanban stays
  meaningful to a human. Absent means not agent work.
- **Claiming.** `POST /tasks/:id/claim` with `{ workerId }` succeeds only
  if the task is still `queued` (a conditional write), so two workers
  can't take the same task. It sets `agentClaimedBy`, `agentClaimedAt`
  and `agentHeartbeatAt`.
- **Heartbeats.** A running worker calls `POST /tasks/:id/heartbeat`
  periodically. The dispatcher requeues a claimed or running task whose
  heartbeat is more than 15 minutes old.
- **Progress.** `POST /tasks/:id/updates` appends a `TASK_UPDATE`
  (`kind`: progress / result / error). This is the progress log shown on
  the phone. It is its own entity rather than a list on the task, so a
  long log can't approach DynamoDB's 400 KB item limit.
- **Polling.** `GET /tasks` takes `status`, `agentState` and
  `updatedSince` filters, applied in the Lambda over the user's task
  items. No new index: at personal scale a partition query is cheap, and
  it avoids a GSI change.

## Usage logging

After each run the worker posts one agent `TIME_ENTRY` (see
`CLIENTS-INVOICING.md`) against the task's project: provider, model,
`costType`, token counts including cache reads and writes, `costUsd` and
`costBasis`, and elapsed time. Claude Code's non-interactive run output
reports these per run.

The user's own interactive Claude Code sessions draw on the same
subscription limits, but no worker launches them, so they are not logged.
Logging them from Claude Code's local session records is not yet
designed.

## Token budget

The Claude subscription has usage limits that reset on rolling windows (a
short window of hours and a weekly one). When they run out, agent work
stops across every Area at once. The budget makes that visible and lets
the worker hold back lower-priority work first.

- `SETTINGS.tokenBudgets` — a list of `{ provider, window: rolling-hours
  | weekly, windowHours (rolling-hours only), limitTokens }`. The limit is
  a number the user sets; there is no reliable way to read the remaining
  subscription allowance programmatically, so the user adjusts it if it
  drifts from what Claude reports.
- Counts **paid usage only** (`costType: paid`): input, output and
  cache-write tokens. Cache reads are excluded; they dwarf the other
  counts and are not a good proxy for the limit.
- `GET /usage/budget` returns used and remaining per window, with per-Area
  usage.
- `SETTINGS.budgetReservePercent` (default 20). Below the reserve, the
  worker only claims tasks whose effective priority is in the top two
  levels of the Priority Ladder.

## Data model

| Entity | Key | Attributes |
|---|---|---|
| `DELEGATE` | `USER#<ownerId>` / `DELEGATE#<serviceSub>` | label, createdAt |
| `TASK` (extended) | — | `status` adds `Unsorted`; + source (phone / web / agent; email later), createdAt, updatedAt, createdBy, agentState, agentClaimedBy, agentClaimedAt, agentHeartbeatAt |
| `TASK_UPDATE` | `USER#<ownerId>` / `TASK_UPDATE#<taskId>#<timestamp>` | kind (progress / result / error), text, actorUserId |
| `SETTINGS` (extended) | — | + tokenBudgets (array), budgetReservePercent |

## API endpoints (new)

- `POST /tasks/:id/claim`, `POST /tasks/:id/heartbeat`
- `GET /tasks/:id/updates` / `POST /tasks/:id/updates`
- `GET /tasks` filters: `status`, `agentState`, `updatedSince`
- `GET /usage/budget`

## Open questions / not yet decided

- Whether the Journal tab agent's own Claude usage (it calls the Anthropic
  API directly) should count against the same token budget and appear in
  the usage summary
- Whether delegation should ever extend to a shared Workspace's data, or
  stay limited to one owner's partition
- How the user's interactive Claude Code sessions get logged as usage
