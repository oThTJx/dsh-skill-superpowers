# DeepSeek Harness (dsh) Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On DeepSeek Harness (`dsh`) these resolve to the tools below. Trust the session's live tool list over this table when they disagree.

| Action skills request | dsh tool |
|---|---|
| Load a skill / "invoke the skill" | `skill` (exact kebab-case name from the session catalog) |
| Create a task checklist | `todo_write` |
| Dispatch a subagent (isolated context) | `subagent` / `subagent_fork` (prefer continuable / background when the skill needs later follow-ups) |
| Send a message to a running subagent | `send_message` |
| List / interrupt running subagents | `list_agents` / `interrupt_agent` |
| Run a long-running command in the background | `run_in_background: true` on the shell tool; collect with `job_output`, stop with `job_kill` |
| Run shell commands | `pwsh` (PowerShell; also bash / terminal tools if present) |
| Read a file | `read` |
| Edit / create a file | `edit` / `write` |
| Find files by path pattern | `glob` |
| Search file contents | `grep` |
| Web search | `web_search` (and web tools if present) |
| Plan mode | `exit_plan_mode` when plan mode is enabled |
| Ask the human a question | `ask_user_question` |

## Invoking skills

- Load skills with `skill` and the **exact kebab-case name** from `<available_skills>`. Do not invent a vendor name prefix.
- `using-superpowers` is already present as a system-prompt section for non-subagent sessions; it is absent from the model catalog. Do not call `skill` for it unless the user asks to reload it via an explicit `/using-superpowers` gesture.
- Announce `Using [skill] to [purpose]` before acting on a loaded skill.
- User-instruction files (`AGENTS.md`, with `CLAUDE.md` as a symlink, plus package/workspace instructions) outrank Superpowers when they conflict.

## Subagent dispatch

- Prefer an **isolated** child (`subagent` / `subagent_fork` with a clean context) for implementers and reviewers. Do not dump the parent transcript into the child; paste only the brief, interfaces, and constraints the skill requires.
- For `subagent-driven-development` and `dispatching-parallel-agents`, use **continuable** children when the profile exposes them: the start call returns a durable `subagentId`, and later turns use `send_message`. One-shot background jobs return a `jobId` collected with `job_output` / stopped with `job_kill` — those cannot receive SDD fix-round follow-ups.
- Issue independent dispatches in the **same assistant message** so they overlap. One dispatch per response runs sequentially.
- If no subagent tool is mounted, say so and run the work inline (or use `executing-plans`) rather than inventing tool names.

## Fix rounds and resume

- Record the child id from the dispatch result. Fix rounds 1–3 **resume the same implementer** with `send_message`; do not spawn a fresh implementer because you assume children cannot be messaged again.
- After review findings, paste a short fix brief (finding list + constraints) into `send_message`. The tool returns no child reply; the child's transcript and any settlement notice are the source of what it did.
- Escalation rounds that require a stronger model may start a **new** child with an explicit higher-tier `model` (and related options when the tool schema exposes them).

## Waiting on children

dsh delivers child completion to the parent as a **settlement notice** (`subagent-settled` / related report surfaces). There is no long-poll wait tool, and **`list_agents` is not a wait**.

After you dispatch background / continuable children and finish any **local** work you can do without their results (ledger lines, packaging the next review brief, reading already-written report files):

1. **End this turn.** Do not call `list_agents`, `send_message` ("how is it going?"), or `interrupt_agent` just to pass time.
2. On the **next** turn, consume the settlement notice and the child's report (or report file path). Then continue the skill (review, fix round, next task).
3. Use `list_agents` only when a settlement notice arrived but the report is missing or unusable, or when you must chase a child that looks stuck **after** a notice should have arrived — never as a status loop inside one turn.
4. `interrupt_agent` is for runaway or clearly wrong children, not impatience while waiting for settlement.

## Model routing on spawns

- When the delegation tool schema accepts `model` / related options, set them **explicitly** on every spawn, following the skill's Model Selection rules. An omitted model often inherits the parent's most capable (and expensive) tier.
- Mid-tier is the default floor for reviewers and for implementers working from prose. Cheapest tier is appropriate only for mechanical transcription or single-file fixes the plan already fully specifies.
- Never copy a model id from an old session or from another harness's docs without checking it against the tools actually offered in this session.

## Detect deepseek-harness repository

Load `dsh-harness-contributor` when markers show you are in the **deepseek-harness** monorepo and the task touches harness behavior, tests, snapshots, documentation contracts, or release practices.

**Strong markers (any one is enough):**

- Root `AGENTS.md` whose layout section names `packages/` workspaces and `@deepseek-ai/dsh-*` packages
- Root `pnpm-workspace.yaml` with `packages/*/*` (or equivalent) harness layout
- Runnable `cordis.yml` / profile entries referencing `dsh-*` plugins

**Weak markers (confirm with a strong marker before treating as harness):**

- `vendor/` Cordis vendoring described in root docs
- Workspace package names matching `@deepseek-ai/dsh-<name>`

Repo-specific command tables and change-type gates live **only in this file** — skill descriptions do not duplicate them.

## Harness verification matrix

When claiming push, PR, or merge readiness **inside deepseek-harness**, run the smallest gate that matches the change surface. `verification-before-completion` owns its own evidence rule; this matrix names repo-specific follow-ups.

| Change surface | Minimum gate before the claim |
|---|---|
| Single package behavior | Focused `vitest` on touched package; `pnpm run typecheck` if types changed |
| Model-visible / session / `SessionEventMap` | Focused tests **and** snapshot or SDK expected-output update per harness testing policy |
| Cross-package API or cordis.yml | `pnpm run build` on affected workspaces; config verify if plugins changed |
| Documentation contracts | `pnpm run doc-sync` (or the doc gate named in root AGENTS for the touched paths) |
| Pre-push / merge claim | Follow `.agents/skills/dsh-pre-push-checks` — smallest checks for the diff, not the full suite by default |

Outside deepseek-harness, use the target project's own test and release practices.

## Environment detection

Skills that create worktrees or finish branches should detect isolation with read-only git before creating anything:

```bash
GIT_DIR=$(cd "$(git rev-parse --git-dir)" 2>/dev/null && pwd -P)
GIT_COMMON=$(cd "$(git rev-parse --git-common-dir)" 2>/dev/null && pwd -P)
BRANCH=$(git branch --show-current)
```

- `GIT_DIR != GIT_COMMON` (and not a submodule) → already in a linked worktree; skip creation.
- Empty `BRANCH` → detached HEAD; do not invent branch/push/PR flows the environment cannot support.
- dsh has no built-in `EnterWorktree` tool: follow `using-git-worktrees` (native tool if the profile adds one, else `git worktree` fallback).

## Visual companion and long-running scripts

- Brainstorming's companion server is a `.sh` launcher under the skill directory. On Windows invoke it through Git Bash's `bash.exe` from `pwsh`, with `run_in_background: true` when the script would otherwise block the tool call, then read `$STATE_DIR/server-info` on a later turn.
- Prefer the skill's own scripts (`task-brief`, `sdd-workspace`, `review-package`) over re-implementing their path rules in prose.

## SDD artifacts

- Keep plan-scoped ledgers and report files on disk under the paths the skill scripts print. Hand artifacts as **file paths** in dispatches; do not paste long prior-task summaries into later children.
- Compaction does not erase those files. After compaction, re-read the ledger before claiming what is done.
