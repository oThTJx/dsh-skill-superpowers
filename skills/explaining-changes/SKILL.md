---
name: explaining-changes
description: Use when the user asks why, when review or teach-back would add learning value, or when extracting a durable lesson is worthwhile. Do not use as a default completion summary or merely because implementation finished.
---

# Explaining Changes

## Overview

Optional **teach-back** — explain observable work and evidence, not invented hidden reasoning.

**Announce at start:** "I'm using explaining-changes to explain what we did and why."

Use this skill when an explanation **adds learning or review value**; **do not load it merely because implementation is complete.**

## When to Use

- User asks why something was done
- Review or teach-back would help the human partner
- A durable lesson is worth extracting after feedback

## When NOT to Use

- Default end-of-turn summary
- Merely because implementation finished
- Bug investigation or implementation (`systematic-debugging`, `incremental-implementation`)

## Evidence rule

**Explain decisions from observable work and evidence, not reconstructed hidden reasoning.**

Source priority:

1. Actual actions taken in this task
2. Repository state you read
3. Verification results you ran
4. Decisions visible in the conversation
5. User-provided requirements

Do **not** infer hidden reasoning from the final diff alone. Do not fabricate alternatives you did not consider.

## Output (keep short)

1. **What changed** — one line
2. **Why this approach** — two or three lines; mention a rejected alternative **only if** it materially affected the choice
3. **How to verify** — one command or check
4. **Next time** (optional) — one line from actual experience, not speculation

## Integration

- **`receiving-code-review`** / **`finishing-a-development-branch`** may recommend this skill when teach-back adds value — single decision point, not after every task
