# Clients & Invoicing

Tracks billable work, human hours and agent token usage, against
contracts, and compiles it into reports and sendable invoices. Lives in
the **hamburger menu**, not the bottom tabs — alongside Settings and
Profile — since it's a less-frequent, management-style task rather than a
daily-use screen.

Not yet implemented: everything in this doc. The deployed Projects router
still carries the older project-level `actualPayRate` / `payUnit` fields,
which move to `CONTRACT` as described below.

## Core concept: Work Areas, Projects, Contracts

Billing hangs off the Area kinds described in `ARCHITECTURE.md`:

| Area kind | Example | Billing |
|---|---|---|
| **Work Area** | PIN | Billable. Usage under it is billed through its contracts |
| **Project Area** | What's Next | Tracked as the user's own cost, never billed. Reportable, in case the area later becomes a business |
| **Life Area** | Personal | Tracked as the user's own cost, never billed |

A project or task can belong to **at most one Work Area** (its effective
Area tags may include any number of Life and Project Areas). Otherwise
the same work could be billed twice. The backend rejects a write that
would give an item a second Work Area.

```
Work Area: PIN
  Project: PIN internal work     → Contract: user → PIN, hourly
  Project: MAF engagement        → Contract: PIN → MAF, flat monthly
  Project: Client B engagement   → Contract: PIN → Client B, hourly
Project Area: What's Next
Life Area: Personal
```

A `Project` can be marked as a paid work role (`isWorkRole`) and carry a
market-rate reference range (`marketRateMin` / `marketRateMax`, e.g.
"$60–120/hr") for what the role is worth. What is actually charged lives
on a `CONTRACT`, not the Project, so terms can change over time (a renewal
at a new rate is a new contract) without rewriting history.

## Clients

A `Client` is a party being billed — not necessarily a user of the app at
all (e.g., an outside company or individual). A Work Area that the user
bills is also a Client: PIN is a Work Area (where the work is organized)
and a Client (who the user invoices).

Clients use the **same manual-share mechanism already built for Areas**
(`sharedWorkspaceId`, optional) — a Client can be personal or shared with
a Workspace, so multiple team members logging work against the same
client see one consistent Client record rather than duplicating it per
person.

Clients, Projects and Contracts are **archived, not deleted**, once any
entry against them has been invoiced, so historical records stay intact.
A delete request on an invoiced item archives it instead.

## Contracts

A `CONTRACT` holds the billing terms for one engagement between an
issuer and a client, over a date range:

- `issuerAreaId` — the Work Area that bills the client (e.g. PIN billing
  MAF). Absent when the issuer is the user themselves (the user billing
  PIN).
- `clientId`, `projectIds` — who is billed, for which projects
- `billingMode`
  - `invoiced` — produces real invoices
  - `tracking` — never invoiced. Produces the reasonableness report only:
    for a flat-rate client, does the fee hold up against the actual hours
    and token cost?
- `payUnit` — `hourly` / `flat` / `per-project`
- `rate` — the hourly rate, the flat fee, or the per-project fee
- `flatRatePeriod` — `monthly` / `one-time` (flat contracts only)
- `tokenBilling`
  - `passthrough` — agent token cost is billed on top, as its own line
  - `included` — token cost is absorbed in the rate, reported but never
    invoiced
- `tokenMarkup` — multiplier on API-equivalent token cost when passed
  through. Default `1.0` (at cost)
- `startDate`, `endDate` (optional, open-ended when absent)

**Two billing layers.** The same work can fall under two contracts at
once: hours and tokens on MAF work count toward the user → PIN contract
and toward PIN → MAF. Each layer is invoiced independently (see
`invoicedContractIds` below). Within a layer — one issuer, one project —
contract date ranges may not overlap; the backend rejects an overlapping
contract.

## Time and usage entries

One `TIME_ENTRY` entity covers both human hours and agent runs, so both
flow through the same reports and invoices.

Common fields:

- `projectId`, `taskId` (optional), `userId` (whose data this is),
  `date`, `hours`, `billable` (boolean — not every logged hour needs to be
  billed), `notes`
- `actorType` — `human` / `agent`
- `contractSnapshots` — for every contract covering this project on this
  date, its `contractId`, `payUnit`, `rate`, `tokenBilling` and
  `tokenMarkup`, **captured at the moment of entry**, not looked up live
  at invoice time. If terms change later, past bills still reflect what
  was true when the work happened.
- `invoicedContractIds` — contracts whose invoice already includes this
  entry. Prevents billing the same work twice within a layer while
  leaving it billable in the other.

Human entries are manually logged, not a live stopwatch timer (matches
how the reference data was already estimated in ranges like "2–4
hrs/week" — precision tracking can be a later enhancement if it turns out
to matter).

Agent entries are written by the agent worker after each run (see
`AGENT-WORKERS.md`) and add:

- `provider` (`anthropic` / `ollama`), `model`, `costType`
  (`paid` / `local`), `agentRunId`
- `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`
- `costUsd` and `costBasis` — `api-equivalent` when the run was covered by
  a subscription rather than charged per token (the current Claude setup),
  `actual` when it was billed per token. Local runs cost `0`.
- `hours` is the run's elapsed time, recorded for reporting.

**Agents are billed by tokens, never by hours.** An agent entry's `hours`
never multiply against an hourly rate. Billing on raw token counts is
avoided too: long Claude sessions reread their cached context every turn,
so cache-read counts run into millions while costing a fraction of normal
tokens. Billing on `costUsd` handles cache pricing and per-model price
differences without a rate table.

## Billing math

Per contract, per period:

| payUnit | Human work | Agent work |
|---|---|---|
| `hourly` | billable human hours × `rate` | `passthrough`: Σ `costUsd` × `tokenMarkup`; `included`: reported only |
| `flat` | `rate` once per `flatRatePeriod` in the range | same |
| `per-project` | `rate` once per project | same |

The **reasonableness report** for a flat contract shows the fee next to
the actual work: human hours, agent token cost, and the effective hourly
rate, `(fee − token cost) ÷ human hours`.

All amounts are USD. Multi-currency is not supported.

## Invoices

Compiled from an `invoiced`-mode contract's uninvoiced, billable entries
over a date range:

- `issuerAreaId` (absent = the user), `clientId`, `contractIds`,
  `invoiceNumber`, date range, `timeEntryIds`, computed `totalAmount`
- `invoiceNumber` is **sequential per issuer** — the user's invoices and
  PIN's invoices are separate number series
- **Line items default to one set per Project** in the period — an hours
  line (hours × rate) or a flat-fee line, plus an agent-usage line when
  tokens are passed through — not one line per entry, though the
  underlying entries remain available to inspect if a client questions a
  line
- `status`: draft → sent → paid. "Sent" is a manual status flag; emailing
  the invoice is on the roadmap.
- Generated as a real PDF, reusing the **S3 exports bucket already built**
  for Budget snapshots (see `ARCHITECTURE.md`/`DATA-MODEL.md`) — no new
  storage pattern needed, just a new document type going into the same
  bucket

Build order: Clients, Contracts, time entries and the usage summary come
first. Invoice generation and PDFs follow; until then the usage summary
gives billable totals.

## Usage summary

`GET /usage/summary` reports, for a date range, human hours, agent hours,
tokens by model, and `costUsd` split by `costType`, broken down per
project. Scoped by one of:

- `areaId` — e.g. all of PIN, including its clients' projects; or a
  Project or Life Area, for the user's own cost
- `clientId` — e.g. MAF only
- `contractId` — billable amount under that contract's terms, plus the
  reasonableness figures for flat contracts

With no scope it returns every Area, grouped by Area kind, so work vs.
non-work usage is visible at a glance.

## Navigation: the hamburger menu

This is the first feature to live outside the six bottom tabs, which
means the menu itself needs documenting as a real navigation surface, not
an afterthought:

- **Settings** — existing preferences (autoSlotTasks, agentAutoExecute,
  push token, token budgets, etc. — see `DATA-MODEL.md`'s `SETTINGS`
  entity)
- **Profile** — user account details
- **Clients & Invoicing** — this subsystem: manage Clients and Contracts,
  review logged work and usage, generate and track invoices

Time *logging* itself likely still happens contextually from the To-Dos
tab (an action on a Task/Project, not buried in the menu) — the menu
section is for managing Clients and producing invoices from work already
logged, not where time entry happens day-to-day. This split (log where
the work is, manage where the business side is) mirrors how Budget cards
and the Journal agent are already split across tabs.

## Data model

| Entity | Key attributes |
|---|---|
| `AREA` (extended) | + `kind` (life / work / project) |
| `PROJECT` (extended) | + `isWorkRole` (boolean), `marketRateMin`, `marketRateMax` |
| `CLIENT` | name, contactName, contactEmail, billingAddress (optional), sharedWorkspaceId (optional, same mechanism as Area), notes, archived |
| `CONTRACT` | issuerAreaId (optional), clientId, projectIds (array), billingMode, payUnit, rate, flatRatePeriod, tokenBilling, tokenMarkup, startDate, endDate, archived |
| `TIME_ENTRY` | projectId, taskId, userId, actorType, date, hours, billable, contractSnapshots, invoicedContractIds, notes; agent entries add provider, model, costType, agentRunId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd, costBasis |
| `INVOICE` | issuerAreaId (optional), clientId, contractIds, invoiceNumber, dateRangeStart, dateRangeEnd, timeEntryIds (array), totalAmount (computed), status (draft/sent/paid), createdAt, sentAt, paidAt, dueDate, notes/terms, pdfS3Key |

## API endpoints (new)

- `PUT /projects/:id/work-role` — sets/clears `isWorkRole` and the
  market-rate range on a Project
- `GET /clients` / `POST /clients` / `PUT /clients/:id` / `DELETE
  /clients/:id` (archives once invoiced)
- `GET /contracts` / `POST /contracts` / `PUT /contracts/:id` / `DELETE
  /contracts/:id` (archives once invoiced)
- `GET /time-entries` / `POST /time-entries` / `PUT /time-entries/:id` /
  `DELETE /time-entries/:id`
- `GET /usage/summary`
- `GET /invoices` / `POST /invoices` (generates from selected entries) /
  `GET /invoices/:id` / `PUT /invoices/:id` (status updates) /
  `GET /invoices/:id/pdf` (generates/returns the PDF from the exports
  bucket)

## Open questions / not yet decided

- A contract created after work has already been logged: should it
  backfill `contractSnapshots` on existing entries in its date range, or
  only apply to entries logged afterward?
- Whether a human entry can be split across two projects, or must always
  be logged per project
