---
name: impact-analysis
description: Use before implementing a fix or feature when the change crosses package, layer, or public API boundaries and you need a short impact map. Do not use for single-file edits, throwaway prototypes, or when the blast radius is already obvious from one file.
---

# Impact Analysis

## Overview

Produce a **short impact map** before coding when blast radius is unclear. This skill names what could break; it does not design the fix.

**Announce at start:** "I'm using impact-analysis to map blast radius before implementing."

## Gate — Load Only When

At least one applies:

- Change crosses **package** or **layer** boundaries (API → service → persistence, plugin → consumer)
- Touches **public API** (exported types, wire fields, session events, tool schemas)
- Affects **compatibility** (on-disk format, config keys, snapshot fixtures)
- Multi-file coordinated change where dependents are not obvious from one file

Skip when the edit is single-file and the only consumer is in the same file.

## Output Format (≤15 lines)

Deliver exactly this structure — no implementation suggestions:

```
## Impact map
- **Change:** [one line — what moves]
- **Direct dependents:** [files/packages that import or call this]
- **Indirect dependents:** [only plausible chains — do not recurse unrelated trees]
- **Tests/fixtures:** [suites or snapshots likely affected]
- **Compatibility:** [breaking / additive / internal only]
- **Risk:** [low / medium / high — one line why]
```

**No implementation suggestions.** Do not list coding steps, refactors, or design alternatives. Stop at the map; implementation skills take over.

## Red Flags

| Thought | Reality |
|---------|---------|
| "I'll figure out impact while coding" | Cross-layer surprises belong in the map first |
| "Let me suggest the fix too" | This skill ends at impact; TDD/incremental own implementation |
| "Search every file in the repo" | Map **plausible** dependents only — no exhaustive unrelated dependency walks |

## Integration

- **After debugging, before fix:** `systematic-debugging` → impact (if gate fires) → `test-driven-development` or `incremental-implementation`
- **Conflict priority:** runs only when the gate fires; yields to debugging and plan execution skills
