# Workspaces & Team Collaboration

Personal use and team collaboration are **two layers of one data model**,
not two separate apps. Everything designed elsewhere (Tasks, Projects,
Life Areas, the Priority Ladder, the agent) works the same whether it's
personal or shared — sharing is something you turn on for a Life Area,
not a different mode of the app.

## Core concept: shared Life Areas

- **`WORKSPACE`** — a named group with multiple members. Not capped at
  two; built to support a growing team from the start.
- **Sharing is manual, at the Life Area level.** You choose to share a
  specific Life Area (e.g., "SmellyCat/PIN") with a workspace. Once
  shared, **everything tagged under that Life Area** — Projects, Tasks,
  Goals — becomes visible and editable to every workspace member, not
  just the original owner. There's no separate "team task" concept; it's
  the same Task entity, just reachable by more than one person once its
  Life Area is shared.
- Unsharing a Life Area (toggling `sharedWorkspaceId` off) returns it to
  being visible only to its original owner — no data migration needed
  either direction, since the entity's location in the table never
  changes (see Data model below).

## Task assignment

`TASK.assignedToUserId` (optional) — meaningful mainly inside a shared
workspace. Your partner can create a task and assign it to you (or
themselves, or leave it unassigned); it shows up on the assignee's
Daily/To-Dos tab exactly like any personally-created task.

## Notifications

**Expo's push notification service** — free at this scale, and Expo is
already the client framework, so no separate AWS notification service
(SNS/Pinpoint) is needed. Triggered when:
- A task is created or assigned to a user inside a shared workspace
- (Future: other shared-workspace events, as they come up)

Each user's push token is stored on their own `SETTINGS` record (see
`DATA-MODEL.md`). Notifications never fire for the actor's own action —
only for other members affected by it.

## Shared agent context

A workspace gets its **own agent conversation**, separate from a user's
private personal Journal chat:
- **Personal agent chat** — private, only the user sees it (`AGENT_MESSAGE`
  in `DATA-MODEL.md`, per `AGENT.md`)
- **Workspace agent chat** — shared, every workspace member sees the full
  history (`WORKSPACE_AGENT_MESSAGE` in `DATA-MODEL.md`)

When your partner brainstorms tasks with the agent inside a shared
workspace, that conversation — and any tasks/goals it created — is visible
to you too, not siloed to their own account. The Journal tab UI needs a
way to switch between "Personal" and a specific workspace when chatting
with the agent; which context is active determines which conversation log
is read/written and which data the agent can act on.

The agent's permissions (free-form CRUD, confirm-before-acting default,
Haiku 4.5, full transaction visibility, etc. — see `AGENT.md`) apply the
same way in a workspace context, just scoped to that workspace's shared
data instead of one user's personal data.

## Access control (the real complexity here)

Every read/write to a Task/Project/Goal now needs an authorization check,
not just an ownership lookup:

1. Does the requesting user own this item directly? (Its `PK` is
   `USER#<requestingUserId>`.) → allowed.
2. If not, does the item belong to a Life Area with a `sharedWorkspaceId`
   set, **and** is the requesting user a member of that workspace? →
   allowed.
3. Otherwise → denied.

This check has to happen on every relevant request, not just at query
time — the backend needs a real authorization layer here, not just
DynamoDB access patterns. Worth writing as a single shared middleware/
utility function (per `CLAUDE.md`'s DRY principle) rather than
reimplementing this check in every route.

## Data model

Rather than moving data between partitions when something gets shared or
unshared (expensive, error-prone), sharing is implemented via a **sparse
GSI**:

| Entity | Key addition |
|---|---|
| `WORKSPACE` | New top-level item: `PK: WORKSPACE#<id>`, `SK: METADATA`. Attributes: name, memberUserIds (array), createdBy, createdAt |
| Workspace membership (reverse lookup) | New item per member: `PK: USER#<memberId>`, `SK: WORKSPACE#<workspaceId>` — lets a user cheaply list their own workspaces without scanning |
| `LIFE_AREA` | New optional attribute: `sharedWorkspaceId`. When set, this Life Area and everything tagged under it becomes workspace-visible. |
| `TASK` | New optional attribute: `assignedToUserId` |
| New GSI (`GSI1`) | Partition key: `sharedWorkspaceId` (sparse — only present on shared items), sort key: `type#id`. Lets the backend query "everything shared to workspace X" in one call, regardless of which user's partition originally owns each item. |
| `WORKSPACE_AGENT_MESSAGE` | `PK: WORKSPACE#<workspaceId>`, `SK: timestamp`. Same shape as `AGENT_MESSAGE`, but shared/readable by all workspace members. |
| `SETTINGS` | New optional attribute: `expoPushToken` |

## API endpoints (new)

- `GET /workspaces` / `POST /workspaces` / `PUT /workspaces/:id` /
  `DELETE /workspaces/:id`
- `POST /workspaces/:id/members` / `DELETE /workspaces/:id/members/:userId`
- `PUT /life-areas/:id/share` — sets or clears `sharedWorkspaceId`
- `POST /workspace-agent/:workspaceId/chat` — same shape as `/agent/chat`,
  scoped to a workspace's shared context and conversation log
- `GET /workspace-agent/:workspaceId/messages`
- `POST /settings/push-token` — registers a user's Expo push token

## Open questions / not yet decided

- Permission granularity within a workspace: can any member share/unshare
  a Life Area, assign tasks to anyone, or does the original owner keep
  some elevated control? Not yet decided — current design treats all
  members as equals once shared.
- What happens to a Task's `assignedToUserId` if that user is later
  removed from the workspace — reassign, clear, or leave dangling?
- Whether the "confirm before acting" agent behavior (per `AGENT.md`)
  needs adjustment in a workspace context — e.g., does *any* member's
  confirmation count, or does an action need to be proposed to the
  specific user it affects?
- Notification granularity: workspace-wide broadcast for every change, or
  only notify the specifically affected member(s)? Current design assumes
  the latter (assignee-only), but worth confirming as usage patterns
  emerge.