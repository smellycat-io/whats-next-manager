# Architecture

This app is a personal life-design dashboard (schedule, budget, goals,
journal) built as its own standalone stack — no shared infrastructure with
PIN or any other project.

**Product context:** intended for eventual App Store release to multiple
users, with more complex features added over time — not just a personal
single-user tool. This shapes decisions elsewhere in this doc (e.g.,
Cognito is a real multi-tenant user pool from the start, not a
single-user placeholder; infra-as-code choice below accounts for
long-term growth).

For the DynamoDB schema and API endpoint list, see `DATA-MODEL.md`. For the
Journal tab's AI agent design, see `AGENT.md`. This doc covers the stack,
deploy flow, and each tab's behavioral design.

## Navigation (bottom tabs)

1. **Daily** — today's plan (see Daily tab logic below)
2. **Calendar** — full calendar view (see Calendar tab logic below)
3. **To-Dos** — task lists (see To-Dos tab structure below)
4. **Budget**
5. **Goals**
6. **Journal** — dated reflection notes plus the general AI agent chat
   (see Journal tab structure below and `AGENT.md`)

## Daily tab logic

The Daily tab is the app's landing screen and its most complex piece. It
merges three sources into one prioritized view, rather than just displaying
the calendar:

1. **Google Calendar events** — read via the backend's `/calendar/*`
   endpoints (backend-proxied OAuth — see Google Calendar token handling
   below), primary calendar (calendar ID 20), cached client-side and
   refreshed periodically rather than polled continuously
2. **Open tasks** from the To-Dos tab that have no specific time assigned
3. **Focus-block definitions** — the weekly schedule, structured as data
   (time range + type tag) rather than static display text, so tasks can be
   matched against it programmatically

**Slotting logic:**
- An unscheduled task is matched to the next open block whose
  `lifeAreaIds` overlaps with the task's effective Life Area tags (its own
  direct tags, or its project's, following the same resolution order used
  for priority). No name-matching involved — both sides reference actual
  Life Area records directly (see `DATA-MODEL.md`). A task tagged with
  multiple Life Areas may match more than one block — matched against
  whichever open block appears first.
- Within a block, priority determines *display order*, not placement — the
  highest-priority matching task shows first; others roll to the next
  available matching block (today or the next day it recurs)
- If no matching block is open today (blocks full or no type match), behavior
  depends on a user setting:
  - **Confirm placement** (default) — a prompt appears asking where to place
    the task, with a checkbox: "Don't ask again, just auto-slot tasks"
  - **Auto-slot** — task is placed in the best-available block automatically,
    no prompt
  - This preference is stored per-user and toggleable in Settings at any time

## Calendar tab logic

Full-scope view, complementary to Daily (which is today-only and merged for
action):

- **Month/week toggle.** Month view shows density per day (visual indicator
  of how full it is); week view shows actual time blocks.
- **Tap a day** → expands into that day's merged view — same Google
  Calendar + focus-block + task logic used on the Daily tab, just for a
  non-today date.
- **Both Google Calendar events and slotted tasks render together**,
  visually distinguished (e.g., solid blocks for hard calendar commitments,
  outlined blocks for flexible tasks) so it's clear what's fixed vs. movable.
- **Recurring focus blocks** (the weekly rhythm) render automatically without
  needing to be recreated per week — they're generated from the focus block
  definitions, not stored as individual repeated events.
- **Write access:** the app can create and edit Google Calendar events
  directly, not just read them. This requires the OAuth scope for
  read/write (`calendar.events`), not just read-only access — a broader
  permission grant than the Daily tab alone would need, so this should be
  requested up front during calendar connection rather than added later.

## Google Calendar token handling

**Decision: backend-proxied**, not client-direct. The client never talks
to the Google Calendar API directly or holds a token itself.

- Client runs the OAuth flow (Expo AuthSession or similar) and gets an
  authorization code
- Client sends that code to the backend, which exchanges it for access +
  refresh tokens
- Backend stores the refresh token **KMS-encrypted directly on the user's
  DynamoDB record** (not AWS Secrets Manager — see rationale below) and
  handles access-token refresh itself
- Every Calendar read/write — from the Daily tab, Calendar tab, or the
  Journal agent — goes through the backend's `/calendar/*` endpoints

This was effectively forced by the Journal agent's design: the agent runs
server-side and needs to act on the calendar via tool-calling, which only
works if the backend holds the token.

**Why KMS-encrypted field over Secrets Manager, given multi-user scaling
plans:** Secrets Manager charges per secret (~$0.40/month) — at 10,000
users that's ~$4,000/month just to store tokens. A single shared KMS key
costs $1/month total (not per user), plus $0.03 per 10,000 encrypt/decrypt
requests (first 20,000/month free) — at 10,000 users with realistic usage,
that's roughly $10/month total, not per user. Same reasoning applies to
Plaid tokens once that phase begins (see `ARCHITECTURE.md` Budget tab
logic and `DATA-MODEL.md`).

## Task → Calendar sync

Tasks aren't just displayed alongside Google Calendar events (as in the
Daily/Calendar merged view above) — a task with a real date/time attached
gets an **actual calendar event created for it**:

- Triggered when a task receives a **deadline**, or is **slotted into a
  specific time block** (via Daily tab auto-slot or Weekly Sprint drag)
- The task stores `linkedCalendarEventId` once its event is created
- If the task's deadline/time changes, the linked event is updated to match
- If the task is completed or deleted, the linked event is deleted
- Backlog tasks with no deadline/time never generate a calendar event —
  only tasks that have actually landed on the calendar do

## To-Dos tab structure

**One unified system** — Life Areas → Projects → Tasks → Subtasks. What
were originally designed as separate "Simple Lists" (groceries, packing
lists) are fully unified into this hierarchy now: a quick list is just a
Project, its items are ordinary Tasks with the full feature set available
(priority, Life Area tags, deadline, status, subtasks) but left blank when
not needed — no separate entity, no restricted task shape, no
`isSimpleList` flag. See `DATA-MODEL.md` for the underlying schema note.

- **Life Area** — a domain of life (e.g., Personal, Work, Family, Side
  Hustles). Each Life Area has a **default priority level** (references the
  Priority Ladder) — e.g., Family → Love/Belonging, Side Hustles →
  Esteem/Self-Actualization.
- **Project** — lives inside one or more Life Areas (many-to-many — e.g., a
  side-hustle project can be tagged under both "Family" and "Security" at
  once, since it can serve more than one purpose). A quick list (groceries,
  packing) is simply a Project a user chooses to keep lightweight — same
  entity, no special case.
- **Task** — lives inside a project, **or stands alone with no project**
  (e.g., everyday to-dos like "call the vet" that don't belong to any
  initiative). Tasks can also be **independently multi-tagged with Life
  Areas**, bypassing the project's tags entirely when set directly on the
  task — this is the same mechanism that lets a standalone task (with no
  project at all) still carry Life Area tags and inherit a default priority
  level.
- **Default priority resolution:** a task's effective priority level
  defaults to the highest-urgency level among whichever Life Area tags
  apply to it — its own direct tags if set, otherwise its project's tags
  (e.g., Family→Love/Belonging + Security→Safety resolves to Safety, since
  that's higher on the ladder). Always manually overridable per task,
  regardless of inheritance.
- **Subtask** — nested under a task.

**Priority Ladder screen** — a dedicated screen, separate from the task
views themselves:
- Shows the user's priority levels stacked top (highest) to bottom (lowest)
- Seeded by default with Maslow's five levels (Physiological → Safety →
  Love/Belonging → Esteem → Self-Actualization)
- Fully editable: add, rename, delete, and reorder levels via drag-and-drop
- Every task references a level on this ladder — the ladder's order *is*
  the default sort order

**Deadline-conflict prompt:** when a task's deadline is today or has
passed, and it sits below higher-priority tasks in the sort order, a prompt
appears: *"[Task] is due today — move it above today's other priorities?"*
- **Confirm** → task is bumped to the top of today's view for that
  day/session only; its priority level is not changed
- **Dismiss** → a deadline picker opens immediately; the task cannot be
  dismissed without setting a new deadline — no silent snoozing allowed

## To-Dos view switcher

Three interchangeable views over the same underlying task data — since
Simple Lists are now just lightweight Projects (see above), all view
switching applies uniformly to every list/project, quick or structured:

- **List** — sorted by Priority Ladder position, then deadline, grouped by
  project. Standalone tasks (no project) group under an implicit "No
  Project" bucket within their tagged Life Area, or across all Life Areas
  if untagged.
- **Kanban** — status-based columns (`Backlog / To Do / In Progress /
  Done`). Requires a `status` field on tasks, separate from `completed`
  (moving a card to "Done" sets `completed: true` automatically). Drag
  between columns.
- **Weekly Sprint** — days-of-week as columns instead of status; tasks
  committed to "this week" get dragged onto a specific day (same underlying
  concept as Daily tab slotting, visualized as a board). Undated/backlog
  tasks sit in an "unscheduled" column at the edge.

## Budget tab logic

**Current phase: manual entry.** Plaid's Transactions product is a
recurring per-account subscription fee (not a one-time cost), so bank
connection is deferred until it's worth paying for — either once this app
has more than one user, or once manual entry becomes enough of a burden to
justify the cost.

**Manual entry flow (current):**
- User enters transactions directly: date, description, amount, category
- Same category structure as the Plaid-based design below — nothing about
  the categorization model changes when Plaid is eventually added, only how
  transactions arrive

**Budget cards** — the main screen is a set of **user-customizable cards**,
not a fixed set of tiers. Defaults: Income, Necessities, Subscriptions,
Lifestyle, Business, Gap to Comfy. Each card (except Business and Gap to
Comfy, which have special logic below) sums transactions from its assigned
categories against an optional target.

- Tapping a card **navigates to a separate detail screen** for that card
  (not an inline expansion) — the detail screen shows the full category
  breakdown, plus an "Add transaction" action pre-filtered to that card
- Main Budget screen also has its own "Add transaction" action for quick
  entry without picking a card first (category chosen at entry time)
- Cards can be added, removed, renamed, retargeted, and reordered — either
  directly by the user, or via the Journal tab agent (see `AGENT.md`)

**Business card — self-funding logic:** shows business cost (summed from
Business-tagged transactions) against **actual revenue**, not an assumed
target. Revenue is computed by linking to a Goal on the Goals tab (e.g.,
"PIN paying members" × price-per-member) — so as that counter moves, the
Business card's revenue figure updates automatically. Until revenue ≥ cost,
the card shows the business as not yet self-funding, rather than implying
otherwise.

**Gap to Comfy card:** unchanged — Comfy target minus Income, shown as a
standalone card.

Budget cards and Goals can also be created/edited by the general agent on
the Journal tab — see `AGENT.md`.

**Live charge notifications:** handled entirely outside this app — most
banks, including SoFi, offer built-in push notifications for transactions
in their own app. No integration needed; this should be turned on directly
in the banking app now rather than waiting on Plaid.

**Future phase: Plaid integration (not yet built).** Documented here so the
data model doesn't need to change when it's added later:
- Plaid Link on the client for the connection flow
- Backend exchanges the resulting public token for an access token
  (`POST /plaid/exchange`), storing only a reference to it (see
  `DATA-MODEL.md` — raw tokens never sit in DynamoDB)
- An EventBridge-scheduled Lambda syncs new transactions periodically
- Categorization flow (applies whether transactions arrive manually or via
  Plaid):
  1. A transaction gets a category, mapped from Plaid's rough category via
     `CATEGORY.plaidCategoryMap` when auto-synced, or chosen directly on
     manual entry
  2. Any transaction can be manually recategorized — this is the same
     correction done by hand with the August statement (rent hiding inside
     a Venmo payment, a one-time Venmo excluded, a mattress purchase
     flagged as non-recurring)
  3. Transactions with no confident category match are flagged for the user
     to sort, rather than silently mis-bucketed

## Goals tab structure

Two goal types:
- **Tally goals** — no target, count up over time (camping trips, concerts,
  bar nights). Card shows a running count with a tap-to-increment button.
- **Target goals** — a specific number to reach (PIN paying members → 13,
  or an agent-created goal like "save $1,137 toward comfy"). Card shows a
  progress bar toward the target.

**Life Area and Priority Ladder integration** — same mechanism as Tasks:
- Every goal can be tagged with one or more Life Areas (many-to-many, same
  as Projects/Tasks)
- Every goal has an effective priority level, defaulting from its tagged
  Life Area(s) using the same highest-urgency-wins resolution used
  elsewhere, manually overridable per goal

**Screen organization:** grouped by type — a **Tally** section and a
**Target** section — with goals sorted by Priority Ladder position within
each group.

## Journal tab structure

Two things side by side in this tab:
- **Free-text entries** — dated reflection notes (`JOURNAL_ENTRY`), as
  originally designed, unchanged
- **The agent chat** — a general-purpose AI portal that can create, edit,
  or delete Tasks, Projects, Budget cards, Goals, and Google Calendar
  events on request. Full agent design, tool access, and open questions
  are in `AGENT.md`.

## Client

- **Expo (React Native + TypeScript)** — single codebase for iOS/Android
- **AsyncStorage** for offline-first local cache — schedule/budget/goals
  should be viewable with no network, then sync when back online
- **React Context/hooks** for state management — no Redux/Zustand needed at
  this size; revisit only if state complexity grows significantly
- No shared component library yet — build reusable components locally
  (buttons, cards, rows) per the DRY/composition rules in `CLAUDE.md`

## Backend

- **API Gateway + Lambda** — Express app via `serverless-http`, same pattern
  used on other projects for familiarity, but its own separate deployment
- **DynamoDB** — single-table design (full schema in `DATA-MODEL.md`)
- **Cognito** — own user pool, separate from any other project's auth,
  currently single-user but structured so it could scale to more users later
  without a rebuild
- **S3** — used only for exports (PDF/CSV budget or goal snapshots), not for
  core app data

## Deploy & repo flow

- GitHub repo, feature/working branches only
- Manual merge: feature branch → `stage` (test) → `main` (production) — no
  automated or agent-initiated merges into either branch
- GitHub Actions: `deploy.yml` for `main`, `deploy-stage.yml` for `stage`
- Infra-as-code: **AWS CDK (TypeScript)** — chosen over Serverless
  Framework given plans to sell this app on the App Store to multiple
  users and keep adding complex features over time; CDK avoids Serverless
  Framework's revenue-gated free tier and shares a language with the Expo
  client

## Open questions / not yet decided

- Whether the schedule ever becomes editable in-app, or stays a static
  reference view
- Export format for S3-stored snapshots (PDF vs. CSV vs. both)
- Plaid environment/plan (sandbox vs. production access) and which
  institutions need support first
- Merchant-based auto-recategorization: exact matching rule (merchant name
  string match vs. Plaid merchant ID) not yet decided

See also `DATA-MODEL.md` for schema-level open questions and `AGENT.md`
for the Journal agent's open questions.