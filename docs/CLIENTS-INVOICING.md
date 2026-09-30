# Clients & Invoicing

Tracks billable time against work roles and compiles it into real,
sendable invoices. Lives in the **hamburger menu**, not the bottom tabs —
alongside Settings and Profile — since it's a less-frequent, management-
style task rather than a daily-use screen.

## Core concept: Projects as billable roles

A `Project` can represent a paid work role (e.g., "COO," "CTO," a
specific client engagement) rather than just a personal initiative.
When it does, it carries pay-rate information:

- `marketRateMin` / `marketRateMax` — reference range for what the role is
  worth (e.g., "$60–120/hr")
- `actualPayRate` — what's actually being paid, separate from market rate
- `payUnit` — hourly / flat / per-project

**Project-level only for now** — Tasks under a work-role Project inherit
these rates; no per-Task override yet. Revisit if a specific task within a
role genuinely needs its own rate.

## Clients

A `Client` is the external party being invoiced — not necessarily a user
of the app at all (e.g., an outside company or individual). A Client can
be tagged to one or more Projects ("bill this role's hours to this
client").

Clients use the **same manual-share mechanism already built for Life
Areas** (`sharedWorkspaceId`, optional) — a Client can be personal or
shared with a Workspace, so multiple team members logging hours against
the same external client see one consistent Client record rather than
duplicating it per person.

## Time entries

Manually logged, not a live stopwatch timer (matches how the reference
data was already estimated in ranges like "2–4 hrs/week" — precision
tracking can be a later enhancement if it turns out to matter):

- `projectId`, `userId`, `date`, `hours`, `billable` (boolean — not every
  logged hour needs to be invoiced), `notes`
- `rateSnapshot` — the Project's `actualPayRate` **captured at the moment
  of entry**, not looked up live at invoice time. This matters: if a rate
  changes later, past invoices must still reflect what was true when the
  work happened.
- `invoiced` (boolean) — set once a time entry has been included in an
  invoice, to prevent accidentally billing the same hours twice

## Invoices

Compiled from a Client's uninvoiced, billable time entries over a date
range:

- `clientId`, `invoiceNumber`, date range, the set of `timeEntryIds`
  included, computed `totalAmount`
- **Line items default to one per Project** (role) in the period — total
  hours × rate — not one line per individual time entry, though the
  underlying entries remain available to inspect if a client questions a
  line
- `status`: draft → sent → paid
- Generated as a real PDF, reusing the **S3 exports bucket already built**
  for Budget snapshots (see `ARCHITECTURE.md`/`DATA-MODEL.md`) — no new
  storage pattern needed, just a new document type going into the same
  bucket

## Navigation: the hamburger menu

This is the first feature to live outside the six bottom tabs, which
means the menu itself needs documenting as a real navigation surface, not
an afterthought:

- **Settings** — existing preferences (autoSlotTasks, agentAutoExecute,
  push token, etc. — see `DATA-MODEL.md`'s `SETTINGS` entity)
- **Profile** — user account details
- **Clients & Invoicing** — this subsystem: manage Clients, review logged
  time, generate and track invoices

Time *logging* itself likely still happens contextually from the To-Dos
tab (an action on a Task/Project, not buried in the menu) — the menu
section is for managing Clients and producing invoices from time already
logged, not where time entry happens day-to-day. This split (log where
the work is, manage where the business side is) mirrors how Budget cards
and the Journal agent are already split across tabs.

## Data model

| Entity | Key attributes |
|---|---|
| `PROJECT` (extended) | + `isWorkRole` (boolean), `marketRateMin`, `marketRateMax`, `actualPayRate`, `payUnit` |
| `CLIENT` | name, contactName, contactEmail, billingAddress (optional), projectIds (array), sharedWorkspaceId (optional, same mechanism as Life Area), notes |
| `TIME_ENTRY` | projectId, userId, date, hours, billable (boolean), rateSnapshot, invoiced (boolean), notes |
| `INVOICE` | clientId, invoiceNumber, dateRangeStart, dateRangeEnd, timeEntryIds (array), totalAmount (computed), status (draft/sent/paid), createdAt, sentAt, paidAt, dueDate, notes/terms, pdfS3Key |

## API endpoints (new)

- `PUT /projects/:id/work-role` — sets/clears `isWorkRole` and pay-rate
  fields on a Project
- `GET /clients` / `POST /clients` / `PUT /clients/:id` / `DELETE
  /clients/:id`
- `GET /time-entries` / `POST /time-entries` / `PUT /time-entries/:id` /
  `DELETE /time-entries/:id`
- `GET /invoices` / `POST /invoices` (generates from selected time
  entries) / `GET /invoices/:id` / `PUT /invoices/:id` (status updates) /
  `GET /invoices/:id/pdf` (generates/returns the PDF from the exports
  bucket)

## Open questions / not yet decided

- Invoice numbering scheme — sequential per account, per client, or
  user-defined?
- Whether marking an invoice "sent" actually emails it (would need SES,
  already listed as planned in other project infra) or is just a manual
  status flag for now
- What happens to time entries if a Client or Project is deleted after
  invoicing — keep historical records intact regardless (likely yes, but
  worth confirming explicitly)
- Multi-currency support — not addressed yet, assumed single-currency for
  now given the reference data is all USD
