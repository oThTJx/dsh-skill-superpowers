---
name: using-superpowers
description: Use when starting any conversation - establishes how to find and use skills, requiring skill invocation before ANY response including clarifying questions. Standing copy is injected via the system-prompt bootstrap; do not load this skill through the model skill tool.
disable-model-invocation: true
---

<SUBAGENT-STOP>
If you were dispatched as a subagent to execute a specific task, ignore this skill.
</SUBAGENT-STOP>

<EXTREMELY-IMPORTANT>
If you think there is even a 1% chance a skill might apply to what you are doing, you ABSOLUTELY MUST invoke the skill.

IF A SKILL APPLIES TO YOUR TASK, YOU DO NOT HAVE A CHOICE. YOU MUST USE IT.

This is not negotiable. You cannot rationalize your way out of this.
</EXTREMELY-IMPORTANT>

## The Rule

**Invoke relevant or requested skills BEFORE any response or action** — including clarifying questions, exploring the codebase, or checking files. If it turns out wrong for the situation, you don't have to use it.

**Before entering plan mode:** if you haven't already brainstormed, invoke the brainstorming skill first.

Then announce "Using [skill] to [purpose]" and follow the skill exactly. If it has a checklist, create a todo per item.

## Skill Priority

When multiple skills apply, process skills come first — they set the approach, then implementation skills carry it out. Brainstorming and systematic-debugging are Superpowers' most common process skills, but the rule holds for any of them.

Process spine first. Load one process skill appropriate to the task.
Only add supporting skills when that process skill explicitly delegates them, or the user clearly requires them.
Do not stack utilities or multiple core skills on trivial edits.

### Implementation Priority

When more than one implementation or quality skill could apply, resolve in this order (higher wins):

1. **systematic-debugging** — any open bug, failure, or unexpected behavior
2. **executing-plans** — beats incremental when an approved multi-task plan exists
3. **incremental-implementation** — beats direct coding for slice discipline within a task
4. **impact-analysis** — only when the cross-layer gate fires
5. **code-simplification** — lowest; never overrides debugging, plans, or active implementation

These priorities break ties — they do not replace reading the skill.

### Contextual gates

Load these only when the evidence matches; they are not higher-priority implementation skills:

| Gate | When |
|------|------|
| **structured-refactoring** | Repeated failures, coupling, architecture walls, or seam problems indicate **structural change is part of the solution** — a decision point, not a bigger implementation strategy |
| **dsh-harness-contributor** | Working inside the deepseek-harness repository (markers in `dsh-tools.md`) — **repo discipline extension**; composes with `incremental-implementation` |
| **explaining-changes** | User asks why; review or teach-back adds value — **not** because implementation finished |

Skills are **contextual guidance, not an automatic workflow**. Load only the skill relevant to the current decision.

### Tiny edits

Some edits are so small that loading process or core skills adds ceremony without benefit. A **tiny edit** skips extra skills when **all five** conditions hold:

| # | Condition |
|---|-----------|
| 1 | **Single file** — one file touched, no coordinated changes elsewhere |
| 2 | **No behavior change** — rename, typo, comment, formatting, or other cosmetic edit |
| 3 | **Not a bug fix** — defects always use `systematic-debugging`, never the tiny-edit path |
| 4 | **Verification if tests exist** — run focused tests for the touched surface when they exist |
| 5 | **No unresolved uncertainty** — no open ambiguity or unverified assumptions; confidence is not evidence |

**Agent confidence is not evidence.** If you have not reproduced, read the code path, or confirmed the edit scope, uncertainty is unresolved — load the appropriate skill instead.

- "Let's build X" → brainstorming first, then implementation skills.
- "Fix this bug" → systematic-debugging first, then domain skills.
- "Rename this variable from foo to bar." → direct tiny-edit path only; do not stack `research`, `domain-modeling`, `codebase-design`, `prototype`, or `grilling`.

## Red Flags

These thoughts mean STOP—you're rationalizing:

| Thought | Reality |
|---------|---------|
| "This is just a simple question" | Questions are tasks. Check for skills. |
| "I need more context first" | Skill check comes BEFORE clarifying questions. |
| "Let me explore the codebase first" | Skills tell you HOW to explore. Check first. |
| "I can check git/files quickly" | Files lack conversation context. Check for skills. |
| "Let me gather information first" | Skills tell you HOW to gather information. |
| "This doesn't need a formal skill" | If a skill exists, use it. |
| "I remember this skill" | Skills evolve. Read current version. |
| "This doesn't count as a task" | Action = task. Check for skills. |
| "The skill is overkill" | Simple things become complex. Use it. |
| "I'll just do this one thing first" | Check BEFORE doing anything. |
| "This feels productive" | Undisciplined action wastes time. Skills prevent this. |
| "I know what that means" | Knowing the concept ≠ using the skill. Invoke it. |

## Rationalizations

These are **rationalizations** — reasons to skip skill steps. If you catch yourself thinking these, STOP and follow the skill exactly:

| Rationalization | Why It's Wrong |
|-----------------|----------------|
| "The user said to start, so I can skip design" | User approval is for the design, not for skipping the process. The skill's HARD-GATE still applies. |
| "Let me be practical and just build it" | "Practical" means following the skill, not improvising. Skills exist because improvisation fails. |
| "This is straightforward enough to skip planning" | Straightforward tasks need short plans, not no plans. Scale the ceremony, not skip it. |
| "The user wants speed, not process" | Skills ARE the speed — skipping them causes rework. The fastest path is the disciplined one. |
| "I'll ask questions while I build" | Skills separate discovery from execution for a reason. Concurrent discovery causes thrashing. |
| "The user approved my approach" | Approving an approach ≠ approving to skip the skill's steps. Each step has its own gate. |
| "I already know what to build" | Knowing ≠ validating. Skills force you to validate assumptions before they become bugs. |
| "The skill is for complex projects" | Skills scale their ceremony to complexity. A simple project gets a simple plan, not no plan. |
| "I'll do the skill steps later" | Later means never. Skills are ordered for a reason — each step depends on the previous. |
| "The user said 'just do it'" | "Just do it" means "don't overthink," not "skip the process." The skill already handles this. |

## Platform Adaptation

If your harness is DeepSeek Harness (dsh), read its reference file for special instructions:

- DeepSeek Harness: `references/dsh-tools.md`

## User Instructions

User instructions (AGENTS.md, CLAUDE.md, etc, direct requests) take precedence over skills, which in turn override default behavior. Only skip skill workflows or instructions when your human partner has explicitly told you to.

## Compliance Check

Before taking ANY implementation action (writing code, creating files, running commands), ask yourself:

1. **Did I load the relevant skill?** If not, load it now.
2. **Did I complete ALL steps in the skill's checklist?** If not, return to the checklist.
3. **Did I get explicit approval for each gate?** If not, present the design and wait.
4. **Am I rationalizing?** Check the Rationalizations table above. If you match any entry, STOP.

If you cannot answer "yes" to all four questions, you are NOT ready to implement. Return to the skill and complete the missing steps.
