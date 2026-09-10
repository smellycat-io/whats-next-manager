# Data Model

DynamoDB single-table design, partitioned by user, differentiated by a
`type` attribute. Same convention used on PIN, for pattern consistency, even
though this app's infrastructure is entirely separate (own AWS account/stack
— see `ARCHITECTURE.md`).

For the *behavior* built on top of these entities (Daily tab slotting,
priority inheritance, view switching, etc.), see `ARCHITECTURE.md` — this
doc is schema and API only. For the Journal tab agent's design, see
`AGENT.md`.

## Table

| PK | SK | type | attributes |
|---|---|---|---|
| `USER#<id>` | `BUDGET_CARD#<cardId>` | `BUDGET_CARD` | name, cardType (income/expense/business/computed), categoryIds (array — which categories feed this card), target (optional), order, linkedGoalId + unitValue (business cards only — revenue = linked goal's count × unitValue) |
| `USER#<id>` | `GOAL#<goalId>` | `GOAL` | name, cadence, count, goalType (tally/target), target (optional — required for target-type goals), lifeAreaIds (array — many-to-many, same as Projects/Tasks), priorityLevelId (optional override — defaults from lifeAreaIds using the same resolution logic as Tasks) |
| `USER#<id>` | `JOURNAL#<timestamp>` | `JOURNAL_ENTRY` | text, date |
| `USER#<id>` | `SCHEDULE#<day>` | `SCHEDULE_OVERRIDE` | blocks (only if the schedule becomes editable in-app) |
| `USER#<id>` | `TASK#<taskId>` | `TASK` | projectId (optional — omitted for standalone tasks), name, description, deadline, priorityLevelId, lifeAreaIds (optional array — overrides project's tags when set), status (Backlog/To Do/In Progress/Done), completed, subtasks (array of `{id, name, completed}`), linkedCalendarEventId (optional — set once a deadline or time-slot triggers calendar sync) |
| `USER#<id>` | `PRIORITY_LEVEL#<levelId>` | `PRIORITY_LEVEL` | name, order |
| `USER#<id>` | `LIFE_AREA#<areaId>` | `LIFE_AREA` | name, defaultPriorityLevelId |
| `USER#<id>` | `PROJECT#<projectId>` | `PROJECT` | lifeAreaIds (array — many-to-many), name |
| `USER#<id>` | `FOCUS_BLOCK#<blockId>` | `FOCUS_BLOCK` | day, startTime, endTime, lifeAreaIds (array — many-to-many, same shape as Project/Task/Goal; a task's effective Life Area tags are matched against this for slotting) |
| `USER#<id>` | `SETTINGS` | `SETTINGS` | autoSlotTasks (boolean), agentAutoExecute (boolean — when false [default], the Journal agent confirms actions before writing; see `AGENT.md`) |
| `USER#<id>` | `TRANSACTION#<txnId>` | `TRANSACTION` | date, description, amount, merchantName, categoryId — currently manually entered; `plaidTransactionId` reserved for future Plaid phase |
| `USER#<id>` | `CATEGORY#<categoryId>` | `CATEGORY` | name, budgetCardId (which card this category rolls up into), plaidCategoryMap (array — unused until Plaid phase) |
| `USER#<id>` | `AGENT_MESSAGE#<timestamp>` | `AGENT_MESSAGE` | role (user/assistant), text, actionsTaken (array — tasks/projects/budget-cards/goals created or edited by this message, for an audit trail) |
| `USER#<id>` | `GOOGLE_ACCOUNT` | `GOOGLE_ACCOUNT` | googleEmail, refreshTokenEncrypted (KMS-encrypted, single shared account-level CMK — see notes), calendarId, connectedAt |

**Deferred — not yet built:** `PLAID_ITEM` (institutionName, accountNames,
accessTokenRef, lastSyncedAt). Plaid's Transactions product is a recurring
per-account subscription cost, so bank connection is deferred until it's
worth paying for. Documented now so the `TRANSACTION`/`CATEGORY` shape
above doesn't need to change when it's added later — see `ARCHITECTURE.md`
Budget tab logic for the phased plan.

### Notes

- Single-table, `type`-differentiated design.
- Schedule is expected to stay mostly static/hardcoded in the client
  initially; `SCHEDULE_OVERRIDE` items are only needed once in-app editing
  is built.
- `TASK.projectId` is optional — a task can stand alone with no project.
- **Simple Lists are fully unified with Projects/Tasks — no separate
  entity, no restricted feature set.** A "grocery list" is just a
  `PROJECT` like any other; its items are ordinary `TASK` records with the
  full feature set available (priority level, Life Area tags, deadline,
  status, subtasks) — simply left blank when not needed. There is no
  `isSimpleList` flag or special-cased task shape; the only difference
  between a quick list and a fully-structured project is how much of the
  existing optional structure the user chooses to fill in.
- `TASK.linkedCalendarEventId` connects a task to an actual Google
  Calendar event once it has a deadline or time slot — see
  `ARCHITECTURE.md` Task → Calendar sync for the full create/update/delete
  lifecycle.
- `TASK.lifeAreaIds`, when set, overrides the parent project's
  `lifeAreaIds` for that task (see priority/slotting resolution logic in
  `ARCHITECTURE.md`).
- `PROJECT.lifeAreaIds` and `TASK.lifeAreaIds` are both many-to-many —
  a project or task can belong to more than one Life Area at once.
- `GOAL.lifeAreaIds` and `GOAL.priorityLevelId` follow the exact same
  tagging and priority-resolution rules as `TASK` (see above) — a goal can
  belong to multiple Life Areas, and its effective priority defaults to the
  highest-urgency level among them unless manually overridden.
- `PLAID_ITEM.accessTokenRef` will store a **KMS-encrypted field on the
  user's record** (not AWS Secrets Manager) once the Plaid phase begins —
  same decision and cost rationale as `GOOGLE_ACCOUNT.refreshTokenEncrypted`
  below. Secrets Manager's per-secret monthly fee doesn't scale
  economically once this app has many users.
- `GOOGLE_ACCOUNT.refreshTokenEncrypted` uses **one shared KMS customer
  managed key (CMK) for all users** — not one key per user — encrypting
  each user's token as a separate ciphertext value on their own record.
  This keeps cost to a single $1/month key plus per-request encrypt/decrypt
  charges (first 20,000/month free, $0.03/10,000 after), rather than
  Secrets Manager's per-secret monthly fee, which would scale linearly and
  expensively with user count. See `ARCHITECTURE.md` Google Calendar token
  handling for the full rationale and the OAuth flow this token supports.
- `TRANSACTION.categoryId` is set automatically via `CATEGORY.plaidCategoryMap`
  once Plaid is added; currently set directly on manual entry. Can always
  be manually corrected — e.g., reclassifying a Venmo payment as rent, or
  moving a one-time tuition payment off a card's default categories
  entirely so it doesn't skew a recurring total.
- `BUDGET_CARD` replaces the old fixed four-tier `BUDGET` entity — cards are
  fully user- (or agent-) customizable: created, renamed, retargeted,
  reordered, or deleted freely. Defaults seeded on account creation: Income,
  Necessities, Subscriptions, Lifestyle, Business, Gap to Comfy.
- `BUDGET_CARD` of `cardType: business` computes revenue from a linked
  `GOAL` (via `linkedGoalId`) multiplied by `unitValue` — e.g., "PIN paying
  members" goal count × $8.99 — rather than an assumed target, so the card
  reflects whether the business is actually self-funding.
- "Gap to Comfy" is a `cardType: computed` card (Comfy target minus Income),
  not backed by its own transactions.
- `AGENT_MESSAGE` logs the Journal tab agent's chat history per user — see
  `AGENT.md` for the full agent design, permissions, and audit trail
  behavior.

## API endpoints

- `GET /budget-cards` / `POST /budget-cards` / `PUT /budget-cards/:id` /
  `DELETE /budget-cards/:id`
- `GET /goals` / `PUT /goals`
- `POST /goals/:id/increment`
- `GET /journal` / `POST /journal`
- `GET /schedule` / `PUT /schedule` (optional, only if schedule becomes
  editable)
- `GET /tasks` / `POST /tasks` / `PUT /tasks/:id` / `DELETE /tasks/:id`
- `GET /life-areas` / `POST /life-areas` / `PUT /life-areas/:id` / `DELETE
  /life-areas/:id`
- `GET /projects` / `POST /projects` / `PUT /projects/:id` / `DELETE
  /projects/:id` (also covers what were previously "Simple Lists" — see
  unification note above)
- `GET /priority-levels` / `PUT /priority-levels` (bulk reorder) / `POST
  /priority-levels` / `DELETE /priority-levels/:id`
- `GET /focus-blocks` / `PUT /focus-blocks`
- `GET /settings` / `PUT /settings`
- `POST /auth/google/connect` — exchanges a client-obtained OAuth
  authorization code for access + refresh tokens; stores the refresh token
  KMS-encrypted on the user's `GOOGLE_ACCOUNT` record (see `DATA-MODEL.md`)
- `GET /calendar/today` — proxies/merges Google Calendar events for the
  Daily tab; backend-proxied (see `ARCHITECTURE.md` Google Calendar token
  handling) — client never calls Google directly
- `GET /calendar/:date` — merged view for any date, powers Calendar tab's
  day-expand view
- `POST /calendar/events` / `PUT /calendar/events/:id` / `DELETE
  /calendar/events/:id` — create/edit/delete Google Calendar events
  directly from the app (requires `calendar.events` read/write OAuth scope)
- `GET /transactions` / `POST /transactions` — list and manually add
  transactions, with tier/category filters
- `PUT /transactions/:id` — edit/recategorize/re-tier a transaction
- `GET /categories` / `POST /categories` / `PUT /categories/:id` /
  `DELETE /categories/:id`
- `POST /agent/chat` — sends a message to the Journal tab agent; backend
  calls the Claude API with current app context (tasks, projects, budget
  cards, goals, recent journal entries) and tool-calling access to the
  relevant CRUD endpoints above, including Google Calendar events, returns
  the reply plus any actions taken
- `GET /agent/messages` — chat history

**Deferred — not yet built:** `POST /plaid/link-token`, `POST
/plaid/exchange`. Added when the Plaid phase begins (see `ARCHITECTURE.md`).

## Open questions / not yet decided

(none remaining specific to this doc — see `ARCHITECTURE.md` and
`AGENT.md` for outstanding design questions)