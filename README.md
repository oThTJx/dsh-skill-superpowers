# @firefly0621/dsh-skill-superpowers

English | [中文](README.zh.md)

Installable DeepSeek Harness plugin bundle that brings [obra/superpowers](https://github.com/obra/superpowers) into product sessions: the full skill library, adapted to dsh tooling, plus a SessionStart-equivalent bootstrap.

Publish name: `@firefly0621/dsh-skill-superpowers` (version tracks the harness family, currently `0.1.0-rc.9`). Source of record for this fork package: [github.com/oThTJx/dsh-skill-superpowers](https://github.com/oThTJx/dsh-skill-superpowers). This package is opt-in and is not part of the official main `dsh-base` composition.

## What it restores

| Superpowers behavior | dsh realization |
|---|---|
| Skills library under `skills/*/SKILL.md` | `ctx.skills` provider `superpowers` (packaged `skills/` directory, dsh-adapted) |
| SessionStart hook injecting `using-superpowers` | `agent/session-start` → `agent.inject()` with the same `<EXTREMELY_IMPORTANT>` framing |
| Platform `references/*-tools.md` | bundled `skills/using-superpowers/references/dsh-tools.md` appended in that bootstrap |
| Subagent skip (`SUBAGENT-STOP`) | no bootstrap when `session.header.origin === 'subagent'` |
| Model loads other skills on demand | existing `dsh-tool-skill` catalog + `skill` tool |

The skill bodies ship as dsh-adapted prose under `skills/` (no vendored source, no git submodule). Foreign-harness tool names and platform references were rewritten for dsh, and the `superpowers:` skill-name prefix was removed. The published tarball includes `skills/` plus `assets/NOTICE.md`, which records the upstream provenance (`obra/superpowers` @ `b36e0829`, v6.3.0) and MIT license.

## Install into a dsh profile

Requires DeepSeek Harness peers at `^0.1.0-rc.5` (`@deepseek-ai/dsh-skill` and related packages), typically from the official CLI/`dsh-base` stack.

```sh
dsh plugin --profile web add @firefly0621/dsh-skill-superpowers
```

From a harness source tree:

```sh
pnpm dsh plugin --profile web add @firefly0621/dsh-skill-superpowers
```

Then boot `dsh --profile web` (or `pnpm dsh web`). If this fork's `dsh-base` already mounts `id: skill-superpowers`, do not add the same row again — disable the base row first, or use a profile that does not include it.

### Local / pre-publish check

```sh
pnpm run build:lib:host
pnpm --filter @firefly0621/dsh-skill-superpowers pack
pnpm dsh plugin --profile superpowers-demo add ./firefly0621-dsh-skill-superpowers-0.1.0-rc.7.tgz
```

(`pnpm pack` writes the tarball to the repository root by default. There is no per-package `build` script; host lib build produces `lib/`.)

## Enable from this monorepo without npm

The fork `dsh-base` composition mounts this plugin by default. Start as usual:

```sh
pnpm dsh web
pnpm dsh --profile headless "task"
```

To omit it, set `disabled: true` on the `superpowers` row. The package still ships `cordis.patch.yml` for custom bases:

```sh
dsh web --patch packages/skill/skill-superpowers/cordis.patch.yml
```

## Config

| Field | Default | Meaning |
|---|---|---|
| `skillsRoot` | packaged `skills/` directory | Absolute skills directory |
| `bootstrap` | `true` | Inject `using-superpowers` (+ dsh adapter) on session start |

## Update Superpowers

There is no vendored submodule. To re-port a newer upstream release, diff the upstream `skills/` against the recorded commit (`b36e0829`, v6.3.0) and re-apply the dsh adaptation by hand: replace foreign-harness tool names and platform references, remove the `superpowers:` prefix, and keep the behavioral content verbatim.

## Model Experience

### Session-start bootstrap

#### What the model sees

On `startup` for non-subagent sessions, one durable user-role plugin message whose text is `buildBootstrapPreamble(...)`: Superpowers' `<EXTREMELY_IMPORTANT>` wrapper, the full `using-superpowers` SKILL.md, then the dsh platform adaptation from `skills/using-superpowers/references/dsh-tools.md`. On `resume`, the same preamble is injected only when the restored log does not already contain a Superpowers bootstrap message (sessions created before this overlay was enabled). If compaction shadows the durable copy, the next pre-step re-injects it, so the guidance cannot stay lost mid-session.

#### Token effect

One large retained preamble per session that needs it; skill catalog entries add their usual summary cost when `dsh-tool-skill` is mounted.

#### KV Cache effect

Append-only after existing reusable prefixes for that session. Resume of a session that already carries the bootstrap does not append another copy; a compaction-shadowed re-inject appends one fresh copy.

### Skill catalog and `skill` tool

#### What the model sees

Indirectly through `@deepseek-ai/dsh-tool-skill`: every model-invocable Superpowers skill name/description in `<available_skills>`, and full bodies when loaded via `skill`.

#### Token effect

Scales with skill count and description caps owned by `dsh-tool-skill`.

#### KV Cache effect

Same as the skill consumer: initial catalog after the reusable prefix; replacements append.

## Known Limitations and Deferred Work

- **No Claude Code hook binary** — bootstrap is a native Cordis listener, not `hooks/session-start`.
- **Cross-harness reference content is removed** — Anthropic's Claude-specific best-practices guide, the CLAUDE.md testing example, and the Claude-derived creation log are deleted rather than shipped; the dsh skill bodies are self-contained.
- **Upstream sync is manual** — no vendored submodule; re-porting means diffing against the recorded commit and re-applying the dsh adaptation.
- **Peers come from DeepSeek Harness** — this bundle does not vendor `@deepseek-ai/dsh-*`; install into a profile that already has the CLI/base stack.
- **Fork default mounts the publish scope** — `dsh-base` depends on `@firefly0621/dsh-skill-superpowers` so the product default and npm identity stay one package; splitting a private workspace name from the publish name remains deferred.
