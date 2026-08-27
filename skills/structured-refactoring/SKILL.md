---
name: structured-refactoring
description: Use when repeated fix attempts suggest an architecture or coupling problem, when a shallow cluster needs deepening, or when refactoring seams is the path to a durable fix. Do not use when the root cause is still unknown, for behavior-changing features, throwaway prototypes, identical behavior cleanup only (use code-simplification), or merely because a change is large, spans several files, or feels complex.
---

# Structured Refactoring

## Overview

Refactor **structure and seams** when evidence shows that is part of the solution — not because the change feels big or hard.

**Announce at start:** "I'm using structured-refactoring to improve seams while keeping the behavioral hypothesis intact."

## Decision gate

Use structured refactoring **only when the evidence indicates that changing the seam or structure is part of the solution.** Do not use it merely because a change is large, because several files are involved, or because the implementation feels complex.

## Behavioral hypothesis

**Refactor must preserve the behavioral hypothesis.** Before changing structure:

1. State the **known behavior** and failure evidence
2. State **invariants** that must stay true
3. Refactor **structure only** — do not silently change the problem definition or slip in behavior changes

## When to Use

- Repeated fixes reveal **coupling** or an **architecture wall**
- Root cause is understood but the **seam** is wrong for a durable fix
- A shallow cluster needs **deepening** (see `codebase-design` / DEEPENING)

## When NOT to Use

- Root cause still unknown (`systematic-debugging` first)
- Ordinary feature implementation (`test-driven-development`, `incremental-implementation`)
- Behavior-preserving clarity pass only (`code-simplification`)
- Throwaway prototypes

## The Process

1. **Confirm evidence** — repeated failures, coupling, or seam problem (not "it's complex")
2. **Lock behavioral hypothesis** — write down behavior, failures, invariants
3. **Find the seam** — smallest structural move that addresses the coupling
4. **Refactor in small steps** — each step stays green
5. **Verify** — `verification-before-completion` before claiming done

## Red Flags

| Thought | Reality |
|---------|---------|
| "The bug is hard, let's refactor" | Complexity alone is not evidence |
| "I'll fix behavior while refactoring" | That is a behavior change, not this skill |
| "Three fixes failed, auto-refactor" | Need evidence the **structure** is the problem |

## Integration

- **From debugging:** when Phase 4 shows repeated failures with architectural pattern, you **may recommend** loading this skill — finish the current debugging gate first
- **From design:** when deepening a shallow cluster shows seam change is required, `codebase-design` **may recommend** this skill — evidence only, not automatic load
