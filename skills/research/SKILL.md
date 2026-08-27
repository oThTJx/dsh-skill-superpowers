---
name: research
description: "Investigate a question against high-trust primary sources and capture cited findings in-repo. Use when the user requests sourced investigation, or a process skill explicitly delegates research. Do not use when the repo alone is sufficient and external citations are unnecessary."
tier: core
---

# Research

Investigate a question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it. Write findings to a single Markdown file in the repo, citing each claim's source. Save it where the repo already keeps such notes; if there is no convention, put it somewhere sensible and say where.

You may load a `subagent` / `subagent_fork` for reading legwork so you can keep coordinating — see `using-superpowers/references/dsh-tools.md`. Do not invent a second research loop outside the budget below.

## Budget

| Dimension | Default | Meaning |
|---|---|---|
| Max research rounds | **1** | One investigate → synthesize cycle |
| Max delegated agents | **1** | Concurrent research subagents |
| Max primary sources **cited in the deliverable** | **3** | Cap on cited sources in the written note, not a hard cap on every tool call |
| Tool calls (search / fetch / read) | **No hard cap** | May exceed three; only the deliverable's cited primary sources are capped |
| Stop condition | Answered with citations, **or** conflicts reported | No “until certain” extra rounds |

Do not treat “budget” as a vague admonition — these dimensions are the contract. Exceeding them requires an explicit user raise.

**Cited sources ≠ tool calls.** Three caps how many primary sources appear as citations in the written note. It does **not** mean “call search at most three times.”

## Process

1. Frame the question and stop conditions with the user if unclear.
2. Investigate within the budget (at most one delegated research `subagent` / `subagent_fork` unless the user raises the cap).
3. Synthesize into one Markdown note with citations.
4. Stop when answered with citations, or when conflicting primary sources are reported — do not open another round by default.
