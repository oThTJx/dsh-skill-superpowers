---
name: dsh-harness-contributor
description: Use when working inside the deepseek-harness repository (see repository markers in dsh-tools.md), especially when making or reviewing changes that should follow repository-specific development conventions, harness behavior, tests, snapshots, documentation contracts, or release practices. Do not use outside that repository, for read-only questions, or as a substitute for systematic-debugging.
---

# DSH Harness Contributor

## Overview

**Repository-specific development discipline** for the deepseek-harness monorepo — not a PR-only checklist, not a substitute for debugging.

**Announce at start:** "I'm using dsh-harness-contributor for harness repository discipline."

## When to Use

- Repository markers match (see `dsh-tools.md` §Detect deepseek-harness repository)
- Making or reviewing changes that should follow harness conventions
- Work touches harness behavior, tests, snapshots, documentation contracts, or model-visible session behavior
- Composes with `incremental-implementation` for multi-file harness work

## When NOT to Use

- Outside deepseek-harness (no repo markers)
- Read-only questions with no harness change
- Open bug investigation (`systematic-debugging` first)

## Process

1. **Detect repo** — if markers match, read `dsh-tools.md` §Detect deepseek-harness repository
2. **Follow harness discipline** — read relevant package/workspace AGENTS and architecture guidance (conceptual; paths in adapter)
3. **Apply change-type gates** — model-visible / session / invariant / snapshot / doc-contract changes need the gates named in harness docs (commands in adapter)
4. **Release practices** — when claiming push, PR, or merge readiness, read §Harness verification matrix in `dsh-tools.md`

## Red Flags

| Thought | Reality |
|---------|---------|
| "Only need this before PR" | Repo discipline applies during development and review |
| "Skip adapter, I know the commands" | Marker detection and command matrix live in `dsh-tools.md` only |
| "Replace debugging" | Bugs still use `systematic-debugging` |

## Integration

- **`incremental-implementation`:** often loaded together for harness multi-file work — not a conflict
- **`verification-before-completion`:** may recommend this skill when repo-specific harness gates are relevant; verification skill keeps its own gate
