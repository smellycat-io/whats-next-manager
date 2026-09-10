# Agent

A single AI agent, embedded in the Journal tab, that can both discuss the
app's data and **act on it directly** — creating, editing, or deleting
Tasks, Projects, Budget cards, Goals, and Google Calendar events on
request, not just answering questions about them. This replaces the
earlier budget-only "Budget Butler" design — one general agent with real
reach across the app, rather than a separate scoped assistant per tab.

## What it can do

- **Tasks & Projects** — create, edit, complete, or delete tasks
  (including subtasks); create or edit Projects and Life Area tags; move a
  task's deadline or priority level
- **Budget** — create, rename, retarget, reorder, or delete Budget cards;
  log a manual transaction on request
- **Goals** — create or edit tally/target goals, adjust cadence or target,
  tag with Life Areas
- **Google Calendar** — create, edit, or delete events directly, same
  scope as the Calendar tab itself
- **Permission level: free-form.** The agent is not constrained to
  adjusting existing records — it can create and delete outright. Treat
  every agent action as if the user typed the equivalent request directly
  into the relevant tab's UI.
- Can also read (not just write) the user's free-text Journal entries as
  context — e.g., referencing a reflection from earlier in the week when
  reasoning about a task or budget request.

## Confirmation behavior

**Default: confirm before acting.** When the agent proposes a change (a
new task, a card retarget, a deleted goal, a calendar event), it presents
the proposed action and waits for the user to confirm before writing
anything — free-form permission (above) settles *what* the agent can do,
this settles *how* it does it.

A **Settings toggle** ("let the agent just do it") switches to immediate
execution — the agent writes changes directly without a confirm step. Same
pattern as the Daily tab's auto-slot setting, kept per-user and adjustable
at any time. The audit trail (above) logs every action regardless of which
mode is active, so a change is always traceable even when confirmation is
skipped.

## Architecture

- **Model:** Claude Haiku 4.5, called via the Anthropic API from a Lambda
  (`POST /agent/chat`) — chosen over Sonnet specifically to minimize cost
  ($1/$5 vs. $2/$10 per million input/output tokens); this agent's job is
  structured CRUD, not deep creative reasoning, so Haiku's capability is a
  good fit. Revisit if it starts getting genuinely complex or ambiguous
  requests wrong. Cheaper non-Claude options exist (Gemini Flash-Lite,
  GPT-4.1 Nano, DeepSeek — roughly 5–10x cheaper per token) but were
  considered and rejected: this agent writes directly to real data
  (tasks, budget, calendar), where tool-calling reliability matters more
  than shaving a few dollars a month at current scale.
- **Context provided per call:** the user's current Tasks, Projects, Life
  Areas, Budget cards, Goals, upcoming Google Calendar events, recent
  Journal entries, and **full transaction-level detail** (individual
  transactions, not just card/category summaries) — enough for the agent
  to reason about real state at the same granularity used when reviewing
  spending together (e.g., pointing at a specific charge driving a card
  over target), not operate blind at a summarized level. **Trimmed, not
  exhaustive** — recent/active records only (e.g., current month's
  transactions, non-completed tasks), not the user's full historical
  dataset on every call, to keep input tokens down directly rather than
  relying on caching alone.
- **Prompt caching** on the repeated context block (tasks, cards, goals,
  Life Areas) — cuts the cost of re-sending it on follow-up messages
  within a session to roughly 10% of the base input price.
- **Tool-calling:** the agent has tool access to the existing internal
  endpoints — task, project, life-area, budget-card, goal, and Google
  Calendar event CRUD (see `DATA-MODEL.md`) — rather than a separate,
  parallel write path. One set of endpoints, two callers (the app's own
  UI, and the agent). Calendar writes use the same `calendar.events`
  OAuth scope already required for the Calendar tab.
- **Conversation persistence:** chat history is saved per user
  (`AGENT_MESSAGE` in `DATA-MODEL.md`), so context carries across sessions
  rather than resetting each time
- **Audit trail:** every message that results in an action logs which
  records — including Calendar events — were created, edited, or deleted
  (`actionsTaken` on the message record) — so any change can be traced
  back to the request that caused it
- **Note on transaction data:** full transaction-level detail is sent to
  the Claude API as context on every call — a deliberate tradeoff, chosen
  for the agent's usefulness over minimizing what leaves the app per
  request. Worth revisiting if the app scales to many users and this data
  volume/sensitivity becomes a bigger concern than it is for a single-user
  build.
- **Rate limiting:** a hard per-user daily/monthly message cap acts as a
  cost safety net against a bug, a loop, or (once multi-user) abuse
  running up an unbounded bill. Hitting the cap shows a plain message to
  the user rather than failing silently or letting the request through.

## Personality & tone

**Fun, casual, direct.** No corporate assistant voice, no hedging, no
over-explaining before acting. Short, plain responses — matches the same
directness the user prefers from Claude generally (brief instructions,
iterative refinement over lengthy exchanges).

Concretely: when proposing an action, state it plainly and wait for
confirmation — don't pad it with disclaimers or ask multiple clarifying
questions before making an obvious suggestion. If the user pushes back on
being asked to confirm ("just do the thing, stop asking"), the agent
should take that as license to be more direct going forward in that
conversation, not just comply with the one request — and can point out
the Settings toggle (`agentAutoExecute`) as the permanent version of the
same thing.

## Journal tab structure

The Journal tab holds two things side by side:
- **Free-text entries** — dated reflection notes, as originally designed
  (`JOURNAL_ENTRY` in `DATA-MODEL.md`), unchanged
- **The agent chat** — the CRUD portal described above

Both live in the same tab because they're related: reflections often
surface the same things the agent would act on ("today felt behind on
everything" → agent can help translate that into actual task/goal
changes).

## Open questions / not yet decided

(none remaining — see `ARCHITECTURE.md` and `DATA-MODEL.md` for
deferred-phase items like Plaid specifics, which are separate from this
agent's design)