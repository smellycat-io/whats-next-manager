# Development Standards

These are the standing rules for any Claude agent (Claude Code, etc.) writing or
modifying code in this repo. Follow them by default — don't ask permission to
apply them, only flag if a specific task seems to require breaking one.

## Core principles

**DRY — Don't Repeat Yourself.**
- If the same logic appears twice, extract it into a function, hook, or shared
  module before adding a third copy.
- Before writing new code, search the codebase for something that already does
  it. Reuse or extend existing utilities rather than duplicating them.
- Config values, magic numbers, and repeated strings belong in one named
  constant, not scattered inline.

**Object-oriented where it earns its keep.**
- Model real entities as classes/objects when they have both state and
  behavior (e.g., a `Budget`, a `ScheduleDay`, a `Goal`) — not for the sake of
  having classes.
- Favor composition over inheritance. Reach for inheritance only when there's
  a genuine "is-a" relationship, not just shared fields.
- Keep objects responsible for one thing. If a class's name needs "and" to
  describe it, split it.
- Encapsulate internal state — expose methods/getters, not raw internals, when
  other code needs to interact with an object.

**Single Responsibility.**
- One function does one job and is named after that job.
- One file/module owns one concern (e.g., storage access, budget math,
  schedule rendering) — don't mix data-fetching, business logic, and
  rendering in the same block.

**Readable over clever.**
- Optimize for the next person (or agent) reading this in six months, not for
  fewest characters.
- Name things by what they mean, not how they're implemented
  (`monthlyCushion`, not `x` or `tmp`).
- A function should be understandable without needing to trace three other
  functions to know what it returns.

## Structure

- Keep components/functions small — if a component is doing data-fetching,
  state management, business math, AND rendering, split it.
- Business logic (budget math, goal-progress calculations, schedule rules)
  lives in plain functions/modules, separate from UI components — so it can
  be tested and reused without a UI.
- Shared UI patterns (buttons, cards, rows) become reusable components, not
  copy-pasted markup with small tweaks.

## State & data

- Persisted data (budget, goals, journal, schedule overrides) goes through a
  single, consistent access layer — don't call the storage API directly from
  multiple unrelated components.
- Prefer explicit, typed shapes for data (even informal — a comment or
  JSDoc showing the object's shape) over loosely-structured objects passed
  around ad hoc.
- Default values and fallbacks are defined once, in one place, not
  re-guessed at every call site.

## Error handling

- Every storage/network call is wrapped in try/catch. Fail visibly to the
  user (a status message), never silently.
- Don't let one failed save block the rest of the UI from working.

## Style

- Consistent naming convention throughout (camelCase for JS variables/
  functions, PascalCase for components/classes).
- No dead code, commented-out blocks, or leftover debug logs in committed
  code — delete it or explain why it's staying.
- Comments explain *why*, not *what* — the code itself should make the "what"
  obvious.

## Before committing / finishing a task

- Re-scan the diff for duplicated logic that should be extracted.
- Confirm each function/class still has one clear job.
- Confirm naming is honest — if a function's behavior grew past its name,
  rename it or split it.