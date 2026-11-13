# Development Standards

This file is read automatically by Claude Code at the start of every session in
this repo. It is the source of truth for how code is written and how work moves
through the repo. Keep it current as decisions change.

These are the standing rules for any Claude agent writing or modifying code
here. Follow them by default. Don't ask permission to apply them; flag it only
when a specific task seems to require breaking one.

Design context lives in `docs/`: `ARCHITECTURE.md` (stack, deploy flow, tab
behavior), `DATA-MODEL.md` (DynamoDB schema and API endpoints), `AGENT.md`,
`WORKSPACES.md`, and `CLIENTS-INVOICING.md`. `README.md` carries the project
Status section.

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
- If a new concern doesn't obviously fit an existing file or folder, ask
  rather than inventing a new location ad hoc. A wrong split is expensive to
  unwind later.
- Once a folder grows enough that distinct concerns are visible in its file
  list, group files into subfolders by concern, not by file type (no generic
  `utils/` or `helpers/` buckets). Don't create subfolders for a folder that is
  still small; flat is fine until grouping earns its keep.

## State & data

- All DynamoDB access goes through the shared helpers in
  `backend/src/db/client.ts`. No raw DynamoDB calls in route files. If a
  helper is missing a capability, extend it rather than bypassing it.
- Persisted client data (budget, goals, journal, schedule overrides) goes
  through a single, consistent access layer — don't call the storage API
  directly from multiple unrelated components.
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
  code. Delete it; git history is the safety net.
- Comments explain *why*, not *what* — the code itself should make the "what"
  obvious. Any workaround for a CDK, Lambda, API Gateway, DynamoDB, or Cognito
  quirk gets a comment explaining the constraint, so it doesn't get "cleaned
  up" by accident later.
- Exported functions and classes that aren't self-explanatory get a short
  comment explaining intent, not restating the signature.

## Avoiding duplicate code and bloat

- Before adding a new route file, entity, or table, check whether an existing
  one already covers the shape you need.
- If the same validation, authorization, or formatting logic shows up in two
  files, pull it into a shared module before a third copy appears.
- Watch for one-off scripts and quick prototypes that quietly become
  permanent. Either clean them up to match these standards or remove them.
- Periodically review recently added files for duplication against the
  existing codebase. It's cheap, and it catches drift before it compounds.

## Docs sync

When a schema, route, permission, or architecture decision is finalized — a new
entity or field, a new endpoint, a new env var, a change to the deploy flow —
write it into the relevant doc in `docs/` before or alongside the code that
implements it. If you're asked to build something and the relevant decision
isn't documented, ask rather than guess. Field shapes, permission boundaries,
and edge cases are decisions, not implementation details, and shouldn't be
invented silently.

When a decision ships, update the doc to describe the current state directly,
as if the design had always been this way. Don't append status labels
("proposed" → "shipped"), PR references, or narrative about when or how it
changed. If part of the design isn't built yet, say so plainly ("not yet
implemented") as a fact about the current codebase. Someone reading a doc for
the first time should learn the system as it stands, not the sequence of PRs
that produced it.

`README.md` has a **Status** section stating what's built and what's in
progress. Update it whenever a major feature ships or a new open question
surfaces. Log open questions in the docs' "Open questions" sections rather than
letting whoever implements a feature resolve them silently.

**Periodic staleness check.** When working in an area of the repo (`infra/`, a
route file, a doc), briefly check whether adjacent files still reflect reality:
an unused construct, a workflow file superseded by another, a comment
describing behavior that has since changed. Flag what you find rather than
trusting a file's presence as proof it's current. This is triggered by working
in that area. It isn't a scheduled audit.

## Git workflow

- All changes go on feature/working branches. No direct commits to `stage` or
  `main`.
- Merging is manual only: feature branch → `stage` (test) → `main`
  (production). No automated or Claude-initiated merges into either branch.
- **Every PR's base branch is `stage`, never `main`.** `gh pr create` defaults
  to the repo's default branch, so pass `--base stage` explicitly every time.
  The one exception is the recurring `stage` → `main` promotion PR, which is
  base `main` / head `stage` by definition.
- Pushes to `stage` and `main` deploy automatically through GitHub Actions
  (`deploy-stage.yml`, `deploy.yml`; see CI/CD in `docs/ARCHITECTURE.md`). A
  merge is a deploy.
- Do not run `cdk bootstrap` or `cdk deploy`. They create billed AWS resources
  and are run manually by Elise. `cdk synth` and `cdk diff` are fine.
- **Branch naming:** `feature/short-description` for new functionality,
  `fix/short-description` for bug fixes, `refactor/short-description` for
  cleanup with no behavior change.
- **One branch per logical unit of work.** Don't let a branch accumulate
  unrelated changes. It keeps diffs reviewable and isolates what broke if
  something did.
- Create a new, appropriately named branch yourself before starting new work
  if one isn't already checked out. Never build directly on `stage` or `main`,
  even if not told to branch first.
- **Before merging feature → `stage`:**
  1. Every package touched builds and type-checks cleanly (`tsc --noEmit`),
     and runs locally where it can.
  2. Any tests written for the change pass.
  3. Read through the diff for duplicated logic, functions or files that no
     longer have one clear job, and names that no longer match what the code
     does.
- Commit messages: a short present-tense summary line (`Add task router`,
  `Fix GSI key name`). Add a body only when the "why" isn't obvious from the
  diff.
- Tag or note stable milestones (e.g., "personal routers live in production")
  so there are clear rollback points.

## Reporting back

- **Final output goes in a copy-paste format.** When wrapping up a task, give
  the summary of what shipped, the PR description, and any exact commands or
  values Elise needs to act on (AWS CLI commands, env var names, URLs) as a
  fenced code block, not prose or markdown with inline bold and bullets. Prose
  formatting doesn't paste cleanly outside GitHub; a code block does.
- **Flag when stage verification is needed.** Before calling a PR ready to
  merge, state plainly whether the change needs manual testing on the stage
  environment first, and why. This applies to new deploy config, IAM or OIDC
  changes, schema or GSI changes, and anything specific to Lambda, API Gateway,
  or Cognito that local checks can't exercise. Put it in the PR description
  (e.g., "Needs a stage pass before merging to main: <specific reason>"). Don't
  assume it's implied by the change touching infra-adjacent code.
- **The chat-facing report adds a mini summary and the original prompt. It
  doesn't replace the PR's full summary.** When wrapping up in the terminal or
  chat, give a short summary of what shipped, then quote back the prompt this
  work was built from, verbatim, so Elise can confirm at a glance that the
  request and the delivery match. The PR description still gets its full
  summary.

## Testing

- Prioritize tests for anything with conditional branching that's easy to get
  subtly wrong: authorization checks (own item vs. shared workspace item),
  priority-level resolution, rate-snapshot and invoicing math, and
  sparse-index behavior like removing `sharedWorkspaceId`.
- Tests should fail loudly and specifically. Assert the actual expected value
  (the exact level, the exact filtered list), not just "no exception thrown",
  so a broken test says what's wrong.
- A test framework hasn't been chosen for this repo yet. Ask before adding
  one.