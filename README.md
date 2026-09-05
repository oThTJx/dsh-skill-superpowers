# @firefly0621/dsh-superpowers

English | [中文](README.zh.md)

Installable DeepSeek Harness plugin bundle that brings [obra/superpowers](https://github.com/obra/superpowers) into product sessions: the full skill library, adapted to dsh tooling, plus a SessionStart-equivalent bootstrap.

Publish name: `@firefly0621/dsh-superpowers` (version tracks the harness family, currently `0.1.0-rc.22`). Source of record for this fork package: [github.com/oThTJx/dsh-superpowers](https://github.com/oThTJx/dsh-superpowers). This package is opt-in and is not part of the official main `dsh-base` composition.

## What it restores

| Superpowers behavior | dsh realization |
|---|---|
| Skills library under `skills/*/SKILL.md` | `ctx.skills` provider `superpowers` (packaged `skills/` directory, dsh-adapted) |
| SessionStart hook injecting `using-superpowers` | `system-prompt/assemble` section `skill:superpowers` with the same `<EXTREMELY_IMPORTANT>` framing (every non-subagent request); `using-superpowers` is user-only in the skill catalog |
| Platform `references/*-tools.md` | bundled `skills/using-superpowers/references/dsh-tools.md` appended inside that section |
| Subagent skip (`SUBAGENT-STOP`) | no bootstrap when `session.header.origin === 'subagent'` |
| Model loads other skills on demand | existing `dsh-tool-skill` catalog + `skill` tool |

The skill bodies ship as dsh-adapted prose under `skills/` (no vendored source, no git submodule). Foreign-harness tool names and platform references were rewritten for dsh, and the `superpowers:` skill-name prefix was removed. The published tarball includes `skills/` plus `assets/NOTICE.md`, which records obra/superpowers (`b36e0829`, v6.3.0) and mattpocock/skills (MIT, Copyright 2026 Matt Pocock) provenance.

## Matt skills (capability extension)

Superpowers remains the workflow kernel (`brainstorming` → `writing-plans` → TDD / debugging / review / verify). Selected [mattpocock/skills](https://github.com/mattpocock/skills) practices ship as a **frozen nine-skill** extension (no tracker ecosystem, no duplicate `tdd` / `diagnosing-bugs` / `code-review` / `grill-me` skill names).

| Tier (`metadata.tier`) | Skills | Notes |
|---|---|---|
| `core` | `domain-modeling`, `codebase-design`, `research` | Model + user |
| `utility` | `prototype`, `wizard`, `resolving-merge-conflicts` | Model + user; prototype is hard-throwaway |
| `session` | `grilling`, `handoff`, `wait-what` | **User-only** (`disable-model-invocation: true`) |

Session skills (`grilling`, `handoff`, `wait-what`) are absent from the model `<available_skills>` catalog and refused by the model `skill` tool. Users invoke them with a whitespace-bounded `/name` token in a user message (for example `/grilling`); `dsh-tool-skill` injects the skill body as instructions. `using-superpowers` is also `disable-model-invocation: true`, but its standing copy arrives through the system-prompt bootstrap rather than that gesture (users may still `/using-superpowers` to reload the body without the adapter).

Obra skills that absorbed Matt merges (keep on obra sync): `brainstorming` (inline Architectural grilling), `using-superpowers` (short anti-stack priority, tiny-edit path, implementation priority, contextual gates), `test-driven-development`, `systematic-debugging` (Stop-the-line, untrusted error output, triage), `requesting-code-review`.

Superpowers extension skills (implementation discipline, not automatic routing): `incremental-implementation`, `impact-analysis`, `code-simplification`, `structured-refactoring`, `dsh-harness-contributor`, `explaining-changes`. The bootstrap `using-superpowers` skill defines when to load them, implementation priority, and contextual gates; `tier` and catalog descriptions do not auto-route.

`tier` is catalog metadata only — not a router. Invocation frontmatter is parsed privately by this provider (plugin-only; upstream harness packages unchanged).

## Install into a dsh profile

Requires DeepSeek Harness peers at `^0.1.0-rc.5` (`@deepseek-ai/dsh-skill` and related packages), typically from the official CLI/`dsh-base` stack.

```sh
dsh plugin --profile web add @firefly0621/dsh-superpowers
```

From a harness source tree:

```sh
pnpm dsh plugin --profile web add @firefly0621/dsh-superpowers
```

Then boot `dsh --profile web` (or `pnpm dsh web`). If this fork's `dsh-base` already mounts `id: superpowers`, do not add the same row again — disable the base row first, or use a profile that does not include it.

### Local / pre-publish check

```sh
pnpm run build:lib:host
pnpm --filter @firefly0621/dsh-superpowers pack
pnpm dsh plugin --profile superpowers-demo add ./firefly0621-dsh-superpowers-0.1.0-rc.22.tgz
```

(`pnpm pack` writes the tarball to the repository root by default. There is no per-package `build` script; host lib build produces `lib/`.)

## Enable from this monorepo without npm

This package is opt-in in the harness source tree. Mount the shipped overlay patch (or `dsh plugin add`):

```sh
pnpm dsh web --patch packages/skill/superpowers/cordis.patch.yml
pnpm dsh --profile headless --patch packages/skill/superpowers/cordis.patch.yml "task"
```

Fork trees that already mount `id: superpowers` in their base need no extra step; set `disabled: true` on that row to omit it.

## Config

| Field | Default | Meaning |
|---|---|---|
| `skillsRoot` | packaged `skills/` directory | Absolute skills directory |
| `bootstrap` | `true` | Contribute `using-superpowers` (+ dsh adapter) as the `skill:superpowers` system-prompt section |

## Update Superpowers

There is no vendored submodule. To re-port a newer obra/superpowers release, diff the upstream `skills/` against the recorded commit (`b36e0829`, v6.3.0) and re-apply the dsh adaptation by hand: replace foreign-harness tool names and platform references, remove the `superpowers:` prefix, and keep the behavioral content verbatim.

**Preserve on obra sync:** Matt-added skill directories (`domain-modeling`, `codebase-design`, `research`, `prototype`, `wizard`, `resolving-merge-conflicts`, `grilling`, `handoff`, `wait-what` and companions); extension skill directories (`incremental-implementation`, `impact-analysis`, `code-simplification`, `structured-refactoring`, `dsh-harness-contributor`, `explaining-changes`); merged sections in `brainstorming`, `using-superpowers` (anti-stack, tiny-edit, implementation priority, contextual gates), `test-driven-development`, `systematic-debugging` (Stop-the-line, untrusted error output, triage), and `requesting-code-review`; private invocation/`tier` parsing in `src/index.ts`; Matt block in `assets/NOTICE.md`.

**CI gate (not README-only):** `tests/superpowers.spec.ts` `skill composition contracts` asserts that skills with `metadata.tier` are exactly those nine Matt names. `catalog description contracts` asserts semantic description groups (fail), positive-segment negative boundaries that block route contradictions (fail), and positive trigger overlap among extension skills (warn only). Dropping a Matt directory or clearing `tier` on obra re-port fails the package suite.

## Model Experience

### System-prompt bootstrap

#### What the model sees

On every non-subagent request, `system-prompt/assemble` prepends section `skill:superpowers` whose text is `buildBootstrapPreamble(...)`: Superpowers' `<EXTREMELY_IMPORTANT>` wrapper, the full `using-superpowers` SKILL.md, then the dsh platform adaptation from `skills/using-superpowers/references/dsh-tools.md`. Agentless assemblies and `session.header.origin === 'subagent'` omit the section. Compaction cannot drop the guidance because it is reassembled with the system prompt each turn, not stored as a one-shot user message.

#### Token effect

One large system-prompt section on every non-subagent request; skill catalog entries add their usual summary cost when `dsh-tool-skill` is mounted.

#### KV Cache effect

Stable prefix for a given skills root and bootstrap toggle: the section text is loaded once at plugin apply and reused. While `bootstrap` stays enabled and the packaged preamble is unchanged, the rendered text is byte-stable so the warm prefix cache is reused. Changing `skillsRoot` or disabling `bootstrap` changes the assembled prompt.

### Skill catalog and `skill` tool

#### What the model sees

Indirectly through `@deepseek-ai/dsh-tool-skill`: every model-invocable Superpowers skill name/description in `<available_skills>`, and full bodies when loaded via `skill`.

#### Token effect

Scales with skill count and description caps owned by `dsh-tool-skill`. The packaged catalog is twenty-nine skills, including six discipline extension skills (`incremental-implementation`, `impact-analysis`, `code-simplification`, `structured-refactoring`, `dsh-harness-contributor`, `explaining-changes`).

#### KV Cache effect

Same as the skill consumer: initial catalog after the reusable prefix; replacements append.

## Known Limitations and Deferred Work

- **No upstream hook binary** — bootstrap is a Cordis `system-prompt/assemble` listener, not `hooks/session-start`.
- **A complete persona replaces every section** — an agent whose composition registers a `complete` persona (agent presets) suppresses all prompt sections, including `skill:superpowers`, for that agent.
- **Packaged preamble must avoid `{{...}}` prompt-variable syntax** — `loadBootstrapPreamble` rejects a complete `{{name}}` group at plugin apply (mirrors skill-always-apply); a custom `skillsRoot` that introduces one fails loud before the first turn.
- **Cross-harness reference content is removed** — foreign platform tool refs, Anthropic skill-authoring guides, and harness-specific testing examples are omitted; `dsh-tools.md` is the sole platform adapter and must stay deep enough for SDD wait/resume/model routing.
- **Upstream sync is manual** — no vendored submodule; re-porting means diffing against the recorded commit and re-applying the dsh adaptation. A local `superpowers/` checkout is for comparison only and is gitignored.
- **Peers come from DeepSeek Harness** — this bundle does not vendor `@deepseek-ai/dsh-*`; install into a profile that already has the CLI/base stack.
- **Fork product bases may mount the publish scope** — some fork `dsh-base` compositions depend on `@firefly0621/dsh-superpowers` so the product default and npm identity stay one package; this monorepo mounts it only via overlay patch or `dsh plugin add`. Splitting a private workspace name from the publish name remains deferred.
