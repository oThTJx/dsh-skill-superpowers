/**
 * obra/superpowers skills for DeepSeek Harness: bundled provider plus session-start
 * bootstrap that mirrors Superpowers' SessionStart hook.
 *
 * @module @firefly0621/dsh-skill-superpowers
 */

import { readFileSync, statSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'skill-superpowers'

/** Skills registry for the catalog; agents for session-start injection. */
export const inject = ['skills', 'agents']

const PROVIDER_NAME = 'superpowers'
const BOOTSTRAP_SKILL = 'using-superpowers'
const PLUGIN_SOURCE = 'superpowers' as const

const DEFAULT_SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url))

/** Superpowers overlay configuration. Invalid values fail plugin load. */
export interface Config {
  /**
   * Absolute directory of Superpowers skill bundles (`<name>/SKILL.md`).
   * Defaults to the dsh-adapted `skills/` directory shipped in this package.
   */
  skillsRoot?: string
  /** When false, skip session-start injection of `using-superpowers`. Default true. */
  bootstrap?: boolean
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  skillsRoot: z.string(),
  bootstrap: z.boolean().default(true),
})

interface ParsedSkillFile {
  readonly name: string
  readonly description: string
  readonly whenToUse: string
  readonly body: string
  readonly dir: string
}

/**
 * Resolve the skills root directory for discovery and bootstrap.
 * @param config - plugin config; missing `skillsRoot` uses the packaged `skills/` directory.
 * @returns absolute skills directory path.
 */
export function resolveSkillsRoot(config: Config = {}): string {
  return config.skillsRoot ?? DEFAULT_SKILLS_ROOT
}

/**
 * Require a readable skills root directory, failing loud on misconfiguration.
 * @param skillsRoot - absolute skills directory path.
 * @throws when the path is missing or not a directory.
 */
export function assertSkillsRoot(skillsRoot: string): void {
  let info
  try {
    info = statSync(skillsRoot)
  } catch (error) {
    throw new Error(
      `dsh-skill-superpowers: skills root missing at ${skillsRoot}`
        + ' (the packaged skills/ directory is missing; reinstall this package)',
      { cause: error },
    )
  }
  if (!info.isDirectory()) {
    throw new Error(`dsh-skill-superpowers: skills root is not a directory: ${skillsRoot}`)
  }
}

/**
 * Discover Superpowers skill candidates under a skills root.
 * @param skillsRoot - directory containing `<name>/SKILL.md` bundles.
 * @returns candidates sorted by name.
 * @throws when the root is missing (callers that want empty-on-missing use a probe first).
 */
export async function listSuperpowersSkills(skillsRoot: string): Promise<readonly SkillCandidate[]> {
  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `dsh-skill-superpowers: skills root missing at ${skillsRoot}`
          + ' (the packaged skills/ directory is missing; reinstall this package)',
        { cause: error },
      )
    }
    throw error
  }
  const candidates: SkillCandidate[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(skillsRoot, entry.name)
    const skillPath = join(dir, 'SKILL.md')
    const parsed = await readSkillBundle(skillPath, dir)
    if (parsed === undefined) continue
    candidates.push(toCandidate(parsed))
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name))
  return candidates
}

/**
 * Load one Superpowers skill body by catalog name.
 * @param skillsRoot - skills root directory.
 * @param skillName - kebab-case skill name.
 * @returns the definition, or `undefined` when missing or invalid.
 */
export async function loadSuperpowersSkill(
  skillsRoot: string,
  skillName: string,
): Promise<SkillDefinition | undefined> {
  if (!isSkillName(skillName)) return undefined
  const dir = join(skillsRoot, skillName)
  const parsed = await readSkillBundle(join(dir, 'SKILL.md'), dir)
  if (parsed === undefined || parsed.name !== skillName) return undefined
  return toDefinition(parsed)
}

/**
 * Build the SessionStart-equivalent preamble Superpowers injects on other harnesses.
 * @param usingSuperpowersRaw - full `using-superpowers` SKILL.md text (including frontmatter).
 * @param dshToolsMarkdown - dsh platform adaptation markdown.
 * @returns model-facing preamble text.
 */
export function buildBootstrapPreamble(usingSuperpowersRaw: string, dshToolsMarkdown: string): string {
  return [
    '<EXTREMELY_IMPORTANT>',
    'You have superpowers.',
    '',
    '**Below is the full content of your `using-superpowers` skill — your introduction to using skills.',
    'For all other skills, call the dsh `skill` tool with the exact catalog name.**',
    '',
    usingSuperpowersRaw.trimEnd(),
    '',
    '## DeepSeek Harness platform adaptation',
    '',
    'Your harness is DeepSeek Harness. Follow this adaptation (same role as Superpowers `references/*-tools.md`):',
    '',
    dshToolsMarkdown.trimEnd(),
    '</EXTREMELY_IMPORTANT>',
  ].join('\n')
}

/**
 * Whether the session log already carries a Superpowers bootstrap injection.
 * @param agent - live agent whose durable events are scanned.
 * @returns true when a prior `plugin: superpowers` instructions message exists.
 */
export function sessionHasSuperpowersBootstrap(agent: Agent): boolean {
  for (const event of agent.session.events) {
    if (event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind === 'plugin' && source.plugin === PLUGIN_SOURCE && source.form === 'instructions') {
      return true
    }
  }
  return false
}

/**
 * Register the Superpowers skill provider and optional session-start bootstrap.
 * @param ctx - Cordis context with `skills` and `agents`.
 * @param config - optional skills root and bootstrap toggle.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const skillsRoot = resolveSkillsRoot(config)
  assertSkillsRoot(skillsRoot)
  const bootstrap = config.bootstrap ?? true

  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    async list() {
      return listSuperpowersSkills(skillsRoot)
    },
    async get(candidate) {
      if (candidate.provider !== PROVIDER_NAME) return undefined
      return loadSuperpowersSkill(skillsRoot, candidate.name)
    },
  }

  ctx.skills.registerProvider(() => provider)

  if (!bootstrap) return

  // Session-start listeners must inject synchronously: createAgent emits the
  // event before the driver runs, and an async read would miss the first claim.
  const preamble = loadBootstrapPreamble(skillsRoot)

  ctx.on('agent/session-start', ({ agent, source }) => {
    if (agent.session.header.origin === 'subagent') return
    if (source === 'startup') {
      injectBootstrap(agent, preamble)
      return
    }
    // Resume restores an existing log. Re-inject only when this session never
    // received the overlay (e.g. created before Superpowers was enabled).
    if (source === 'resume' && !sessionHasSuperpowersBootstrap(agent)) {
      injectBootstrap(agent, preamble)
    }
  })
}

/**
 * Synchronously load the SessionStart preamble from disk.
 * @param skillsRoot - Superpowers skills directory containing `using-superpowers`.
 * @returns the complete model-facing preamble text.
 */
export function loadBootstrapPreamble(skillsRoot: string): string {
  const usingRaw = readFileSync(join(skillsRoot, BOOTSTRAP_SKILL, 'SKILL.md'), 'utf8')
  const dshTools = readFileSync(join(skillsRoot, BOOTSTRAP_SKILL, 'references', 'dsh-tools.md'), 'utf8')
  return buildBootstrapPreamble(usingRaw, dshTools)
}

function injectBootstrap(agent: Agent, preamble: string): void {
  agent.inject(createUserMessage({
    content: [{ type: 'text', text: preamble }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN_SOURCE,
      form: 'instructions',
    },
  }))
}

async function readSkillBundle(skillPath: string, dir: string): Promise<ParsedSkillFile | undefined> {
  let raw: string
  try {
    const info = await stat(skillPath)
    if (!info.isFile()) return undefined
    raw = await readFile(skillPath, 'utf8')
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
  const parsed = parseFrontmatter(raw)
  if (parsed === undefined) return undefined
  const skillName = parsed.data.name
  const description = parsed.data.description
  if (typeof skillName !== 'string' || typeof description !== 'string') return undefined
  if (!isSkillName(skillName)) return undefined
  return {
    name: skillName,
    description,
    whenToUse: resolveWhenToUse(parsed.data, description),
    body: parsed.body,
    dir,
  }
}

function toCandidate(parsed: ParsedSkillFile): SkillCandidate {
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: parsed.dir },
    rank: BUNDLED_SKILL_RANK,
    locator: parsed.dir,
  }
}

function toDefinition(parsed: ParsedSkillFile): SkillDefinition {
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    invocation: { modelInvocable: true, userInvocable: true },
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: parsed.dir },
    content: parsed.body,
  }
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } | undefined {
  const firstLineEnd = raw.indexOf('\n')
  if (firstLineEnd < 0) return undefined
  const firstLine = raw.slice(0, firstLineEnd).replace(/\r$/, '')
  if (firstLine !== '---') return undefined
  const start = firstLineEnd + 1
  const closing = findClosingFrontmatter(raw, start)
  if (closing === undefined) return undefined
  let data: unknown
  try {
    data = parseYaml(raw.slice(start, closing.start))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  return { data: data as Record<string, unknown>, body: raw.slice(closing.bodyStart) }
}

/**
 * Prefer explicit frontmatter routing (`whenToUse` / `when_to_use`).
 * Upstream Anthropic/Cursor skills usually put that text in `description`;
 * publish it on `whenToUse` so UI/RPC consumers that prefer that field still
 * see the same routing signal. The model catalog continues to use `description`.
 * @param data - parsed YAML frontmatter object.
 * @param description - required skill description.
 * @returns non-empty routing string.
 */
function resolveWhenToUse(data: Record<string, unknown>, description: string): string {
  return stringField(data, 'whenToUse') ?? stringField(data, 'when_to_use') ?? description
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function findClosingFrontmatter(raw: string, start: number): { start: number; bodyStart: number } | undefined {
  let lineStart = start
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf('\n', lineStart)
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/, '')
    if (line === '---') {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 }
    }
    if (nextNewline < 0) return undefined
    lineStart = nextNewline + 1
  }
  return undefined
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
