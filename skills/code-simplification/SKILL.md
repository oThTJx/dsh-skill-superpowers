---
name: code-simplification
description: Use when code works and tests pass but readability or structure still hurts maintainability, after implementation is complete. Do not use for bug fixes, feature work, or changes that alter behavior.
---

# Code Simplification

## Overview

Improve clarity and structure **without changing behavior**. This is a quality pass, not a feature or fix path.

**HARD-GATE:** Behavior must stay identical. If you need different outputs, semantics, or API shape, you are not simplifying — you are implementing. Stop and use the appropriate skill.

**Announce at start:** "I'm using code-simplification for a behavior-preserving clarity pass."

## When to Use

- Implementation is complete and verified
- Tests already pass on the current behavior
- Names, structure, or duplication hurt maintainability
- Your human partner asked for a clarity pass

## When NOT to Use

- Bug fixes or defect investigation (`systematic-debugging`)
- New features or behavior changes (`test-driven-development`, `incremental-implementation`)
- Pre-implementation design questions (`brainstorming`, `codebase-design`)
- While debugging is still open

## The Process

1. **Confirm green baseline** — run relevant tests; do not simplify on red
2. **One simplification at a time** — rename, extract, inline, or dedupe; verify after each
3. **Stay at identical behavior** — no "while I'm here" fixes or feature additions
4. **Use `verification-before-completion`** before claiming the pass is done

## Red Flags

| Thought | Reality |
|---------|---------|
| "This simplification also fixes the bug" | That is a bug fix, not simplification |
| "I'll refactor before tests pass" | Simplification requires a green baseline |
| "Same enough behavior" | Identical means identical — tests must stay green without assertion changes that alter meaning |

## Integration

- **Lowest implementation priority** — debugging, plans, incremental work, and impact analysis all come first
- **After review:** optional follow-up to `requesting-code-review` when the pass is large
