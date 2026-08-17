# DeepSeek Harness (dsh) Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file"). On DeepSeek Harness (`dsh`) these resolve to the tools below.

| Action skills request | dsh tool |
|---|---|
| Load a skill / "invoke the skill" | `skill` (exact kebab-case name from the session catalog) |
| Create a task checklist | `todo_write` |
| Dispatch a subagent (isolated context) | `subagent` / `subagent_fork` (background by default) |
| Send a message to a running subagent | `send_message` |
| List / interrupt running subagents | `list_agents` / `interrupt_agent` |
| Run a long-running command in the background | background jobs via `run_in_background: true`; collect with `job_output`, stop with `job_kill` |
| Run shell commands | `pwsh` (PowerShell; also bash / terminal tools if present) |
| Read a file | `read` |
| Edit / create a file | `edit` / `write` |
| Find files by path pattern | `glob` |
| Search file contents | `grep` |
| Web search | `web_search` (and web tools if present) |
| Plan mode | dsh plan-mode tools (e.g. `exit_plan_mode`) when enabled |
| Ask the human a question | `ask_user_question` (when confirmation or a choice is needed) |

## Notes

- Load skills with the `skill` tool and the **exact kebab-case name** from the session `<available_skills>` catalog. Do not invent a `superpowers:` name prefix.
- `using-superpowers` is injected at session start; do not call `skill` again for it unless the user asks to reload it.
- User-instruction files: dsh reads `AGENTS.md` (with `CLAUDE.md` as a symlink) plus package/workspace instructions; they outrank Superpowers when they conflict.
- Announce `Using [skill] to [purpose]` before acting on a loaded skill.
