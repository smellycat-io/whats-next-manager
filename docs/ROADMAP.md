# Roadmap

Potential additions to What's Next. Nothing here is committed design.
When an item is committed, its design moves into the relevant doc
(`ARCHITECTURE.md`, `DATA-MODEL.md`, `WORKSPACES.md`,
`CLIENTS-INVOICING.md`, `AGENT.md`, `AGENT-WORKERS.md`) and it is removed
from this file.

Four horizons, in rough build order:

1. Core additions — extend what is already designed
2. Clients & Invoicing extensions
3. New surfaces — What's Next Email, then News Reel
4. Later extensions — devices and wearables

## 1. Core additions

### Recurring tasks and routines

A Task can repeat on a cadence (daily, weekly, monthly, custom). One-time
and regular tasks are the same `TASK` entity; a regular task carries a
recurrence rule and generates its next occurrence when the current one is
completed.

- Likely schema: `TASK.recurrence` (optional — cadence, interval, end date)
- Recurring tasks with a time slot follow the existing Task → Calendar
  sync rules in `ARCHITECTURE.md`
- Free tier

### Goal-to-task linking

A Task or Project can be linked to a Goal. Completing linked tasks moves
the goal forward.

- Likely schema: `TASK.goalId` / `PROJECT.goalId` (optional)
- Target goals: progress bar can be driven by completed linked tasks
- Tally goals: completing a linked task increments the count
- Free tier

### Weekly review

The agent produces a recap of the week: tasks completed, tasks that
slipped, spending against budget cards, goal movement. It then drafts
next week's plan for confirmation.

- Stored as a Journal entry, so reviews form a dated record
- Uses the existing confirm-before-acting behavior in `AGENT.md` for any
  tasks or calendar events it proposes
- Paid tier (agent feature)

### Task comments and activity feed

Members of a shared workspace can comment on a Task and see what changed
since they last looked.

- Likely schema: `TASK_COMMENT` and `ACTIVITY` items in the task owner's
  partition, readable through the same access check as the Task
- Comment notifications use the existing Expo push setup in
  `WORKSPACES.md`
- Agent progress notes already exist as `TASK_UPDATE` (see
  `AGENT-WORKERS.md`); comments should share its display rather than
  becoming a second, parallel log

### Workspace roles and permissions

Owner, member, and guest levels inside a Workspace. This resolves the
first open question in `WORKSPACES.md`, which currently treats all
members as equals.

- Owner: manage members, share and unshare Areas, delete the workspace
- Member: full read/write on shared items, assign tasks
- Guest: limited to specific shared Projects, comment and complete only
- Should be designed before the team grows past two people, since it
  changes the authorization middleware

### Project templates

Save a Project's task and subtask structure as a reusable template, then
create new Projects from it (for example, onboarding a new client).

- Likely schema: `PROJECT_TEMPLATE` (name, tasks, subtasks, default Area tags)
- Templates can be personal or shared with a Workspace

## 2. Clients & Invoicing extensions

`CLIENTS-INVOICING.md` already covers Clients, Contracts (billing terms),
time and agent usage entries, invoice generation, PDF output, and a
draft → sent → paid status. These extend it.

- **Overdue status and reminders.** `INVOICE.dueDate` already exists. Add
  an `overdue` status and a push notification when an invoice passes its
  due date unpaid.
- **Send invoices by email.** Marking an invoice "sent" emails the PDF to
  the Client's `contactEmail`. This resolves an existing open question in
  `CLIENTS-INVOICING.md` and needs SES.
- **Contract documents and terms.** `CONTRACT` already holds billing
  terms. This adds scope, payment terms, and the signed document stored in
  S3. Invoice terms and due dates default from the contract.
- **Estimates and proposals.** A quote sent before work begins, which
  converts into a Project and Contract once accepted.
- **Billable expenses.** Expenses logged against a work-role Project and
  added to the invoice as their own line items.
- **Payment recording.** Record payments against an invoice, including
  partial payments, with a remaining balance.
- **Year-end summary.** Total invoiced and paid per Client per year,
  exportable for tax prep.

## 3. New surfaces

### What's Next Email

Email integration that puts every account in one place and turns email
into action.

- **Unified inbox** — all connected email accounts in one view
- **Coupon saving** — offers and promo codes are pulled out of marketing
  email and kept in a searchable list with expiry dates
- **Spam cleanup** — spam and junk are identified and deleted
- **Client communication** — email to and from a Client's `contactEmail`
  is linked to that `CLIENT` record and visible from Clients & Invoicing
- **Work communication as tasks** — an email becomes a Task (or the agent
  proposes one), with a link back to the original thread. These tasks
  arrive with `source: email` and status `Unsorted`, the same entry point
  as tasks dropped in from the phone, so the dispatcher in
  `AGENT-WORKERS.md` sorts them like anything else

Design notes:

- Gmail first. The backend already holds a Google refresh token per user
  for Calendar (`GOOGLE_ACCOUNT`); Gmail access is an added scope on the
  same connection. Other providers (Outlook, IMAP) come after.
- Sorting, coupon extraction, and task proposals are agent work, so they
  sit in the paid tier. The unified inbox view can be free.
- Deleting email follows the agent's confirm-before-acting default until
  the user opts into automatic cleanup.

### News Reel

A single feed for things to read, kept separate from things to do.

- **From email** — family updates, newsletters, and other non-actionable
  mail, routed here by What's Next Email so it stays out of the inbox
- **From the web** — subscribed web pages, news sources, and RSS feeds

**Interest onboarding**

The first time a user opens News Reel, they pick interests from a set of
topic chips (Tech, Business, Local news, Outdoors, Music, Food, Personal
finance, and so on). Each topic carries a starter set of curated sources,
and picking a topic subscribes the user to them automatically. The feed
has content from the first session instead of starting empty.

- Topic picker with a minimum selection (for example, pick at least 3)
- Optional step to refine within a topic (Tech → AI, gadgets, startups)
- Optional location step for local news, using the user's city
- A preview of the sources each topic adds, with the option to drop any
  of them before finishing
- Every auto-subscribed source can be removed later; sources added from
  onboarding are marked so they can be cleared together
- Interests can be revisited from News Reel settings at any time
- Areas can suggest topics (a Side Hustles area suggests business
  and startup sources), but suggestions start unselected

Over time, the feed can reorder by what the user actually reads and
suggest new sources within chosen topics. Suggestions are always opt-in;
nothing is subscribed without a tap.

Design notes:

- Depends on What's Next Email for the email half. The web half (RSS and
  page subscriptions) has no dependency and could ship first.
- Likely schema: `FEED_SOURCE` (type: rss / webpage / email-sender, url or
  sender, name) and `FEED_ITEM` (sourceId, title, summary, link,
  publishedAt, read)
- Onboarding schema: `INTEREST_TOPIC` (global catalog — name, parent
  topic, starter source list), `USER_INTEREST` (topicId, selectedAt), and
  `FEED_SOURCE.addedVia` (onboarding / manual / suggestion)
- The topic catalog and starter sources are curated by us and stored
  outside any user's partition, since every user reads the same catalog
- A scheduled Lambda polls RSS and subscribed pages

## 4. Later extensions

Placeholders only. No design work until the surfaces above are in use.

- **Smart home devices** — routines and tasks that trigger or respond to
  home devices
- **Meta glasses** — hands-free capture to the agent and glanceable
  "what's next"
- **Smart watch** — today's plan, task check-off, and notifications on
  the wrist

## Open questions / not yet decided

- Where Email and News Reel live in navigation. There are already six
  bottom tabs. Options: new tabs, hamburger menu entries, or separate
  companion apps under the What's Next name.
- Gmail's read and modify scopes are restricted scopes. A public app that
  uses them must pass Google's verification and a recurring third-party
  security assessment. This affects cost and timeline for any release
  beyond personal and team use.
- Whether email bodies are stored in DynamoDB/S3 or fetched live from the
  provider each time. Storing less reduces the security burden.
- Which Email and News Reel features are free and which are paid.
- Whether Contracts need e-signature or only store a document signed
  elsewhere.
- Who curates and maintains the News Reel starter sources, and how often
  the catalog is reviewed for dead or low-quality feeds
- Whether topic-based suggestions use the agent (paid) or simple
  read-count ranking (free)
- Whether recurring tasks generate the next occurrence on completion or
  on a fixed schedule regardless of completion.
- Agent model and cost for email triage at volume. Haiku 4.5 is the
  current agent model; inbox-scale classification changes the rate-limit
  assumptions in `AGENT.md`.
