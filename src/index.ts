/**
 * obra/superpowers skills for DeepSeek Harness: bundled provider plus
 * system-prompt section bootstrap that mirrors Superpowers' SessionStart hook.
 *
 * The bootstrap preamble lives in `system-prompt/assemble` sections (not a
 * user message): system prompt content is sent with every request and carries
 * higher model attention than early conversation history that compaction or
 * long sessions push away.
 *
 * @module @firefly0621/dsh-superpowers
 */

import { readFileSync, statSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { parse as parseYaml } from 'yaml'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import {
  BUNDLED_SKILL_RANK,
  isSkillName,
  type SkillCandidate,
  type SkillDefinition,
  type SkillInvocationPolicy,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'superpowers'

/** Skills registry for the catalog. */
export const inject = ['skills']

/** Prompt section name for the Superpowers bootstrap preamble. */
const SECTION_NAME = 'skill:superpowers'

const PROVIDER_NAME = 'superpowers'
const BOOTSTRAP_SKILL = 'using-superpowers'

const DEFAULT_SKILLS_ROOT = fileURLToPath(new URL('../skills/', import.meta.url))

/** Opaque discovery locator stored on each Superpowers catalog candidate. */
interface SuperpowersLocator {
  readonly path: string
  readonly directory: string
}

/** Optional skip reporter for discovery (typically `ctx.logger.warn`). */
export type SkillSkipReporter = (message: string) => void

/** Superpowers overlay configuration. Invalid values fail plugin load. */
export interface Config {
  /**
   * Absolute directory of Superpowers skill bundles (`<name>/SKILL.md`).
   * Defaults to the dsh-adapted `skills/` directory shipped in this package.
   */
  skillsRoot?: string
  /** When false, skip the `skill:superpowers` system-prompt section. Default true. */
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
  readonly invocation: SkillInvocationPolicy
  readonly tier?: SkillTier
}

/** Catalog/routing hint for Matt skill priority metadata (not a runtime router). */
type SkillTier = 'core' | 'utility' | 'session'

const SKILL_TIERS: ReadonlySet<string> = new Set(['core', 'utility', 'session'])

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
      `dsh-superpowers: skills root missing at ${skillsRoot}`
        + ' (the packaged skills/ directory is missing; reinstall this package)',
      { cause: error },
    )
  }
  if (!info.isDirectory()) {
    throw new Error(`dsh-superpowers: skills root is not a directory: ${skillsRoot}`)
  }
}

/**
 * Discover Superpowers skill candidates under a skills root.
 * Directory name must equal frontmatter `name`; mismatches are skipped.
 * @param skillsRoot - directory containing `<name>/SKILL.md` bundles.
 * @param options - optional skip reporter for operators.
 * @returns candidates sorted by name.
 * @throws when the root is missing (callers that want empty-on-missing use a probe first).
 */
export async function listSuperpowersSkills(
  skillsRoot: string,
  options: { onSkip?: SkillSkipReporter } = {},
): Promise<readonly SkillCandidate[]> {
  const onSkip = options.onSkip
  let entries
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `dsh-superpowers: skills root missing at ${skillsRoot}`
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
    const parsed = await readSkillBundle(skillPath, dir, onSkip)
    if (parsed === undefined) continue
    if (parsed.name !== entry.name) {
      onSkip?.(
        `dsh-superpowers: skill at ${skillPath} ignored:`
          + ` directory name "${entry.name}" must equal frontmatter name "${parsed.name}"`,
      )
      continue
    }
    candidates.push(toCandidate(parsed, skillPath))
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name))
  return candidates
}

/**
 * Load one Superpowers skill body by catalog name (directory == name).
 * Prefer {@link loadSuperpowersSkillAt} when a discovery locator is available.
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
 * Load one Superpowers skill from an absolute SKILL.md path.
 * @param skillPath - absolute path to `SKILL.md`.
 * @param dir - skill bundle directory (resource base).
 * @returns the definition, or `undefined` when missing or invalid.
 */
export async function loadSuperpowersSkillAt(
  skillPath: string,
  dir: string,
): Promise<SkillDefinition | undefined> {
  const parsed = await readSkillBundle(skillPath, dir)
  if (parsed === undefined) return undefined
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
 * Synchronously load the SessionStart preamble from disk.
 * @param skillsRoot - Superpowers skills directory containing `using-superpowers`.
 * @returns the complete model-facing preamble text.
 * @throws when bootstrap files are missing or the preamble contains `{{...}}` groups.
 */
export function loadBootstrapPreamble(skillsRoot: string): string {
  const usingPath = join(skillsRoot, BOOTSTRAP_SKILL, 'SKILL.md')
  const dshToolsPath = join(skillsRoot, BOOTSTRAP_SKILL, 'references', 'dsh-tools.md')
  const usingRaw = readTextFileOrThrow(usingPath, 'using-superpowers SKILL.md')
  const dshTools = readTextFileOrThrow(dshToolsPath, 'dsh-tools.md platform adapter')
  const preamble = buildBootstrapPreamble(usingRaw, dshTools)
  if (hasPromptVariableSyntax(preamble)) {
    throw new Error(
      'dsh-superpowers: bootstrap preamble contains {{...}} prompt-variable syntax'
        + ' the system prompt cannot carry'
        + ` (check ${usingPath} and ${dshToolsPath})`,
    )
  }
  return preamble
}

/**
 * Register the Superpowers skill provider and optional system-prompt section bootstrap.
 * @param ctx - Cordis context with `skills`.
 * @param config - optional skills root and bootstrap toggle.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const skillsRoot = resolveSkillsRoot(config)
  assertSkillsRoot(skillsRoot)
  const bootstrap = config.bootstrap ?? true
  const onSkip: SkillSkipReporter = (message) => { ctx.logger.warn(message) }

  const provider: SkillProvider = {
    name: PROVIDER_NAME,
    async list() {
      return listSuperpowersSkills(skillsRoot, { onSkip })
    },
    async get(candidate) {
      if (candidate.provider !== PROVIDER_NAME) return undefined
      const locator = asSuperpowersLocator(candidate.locator)
      if (locator !== undefined) {
        return loadSuperpowersSkillAt(locator.path, locator.directory)
      }
      return loadSuperpowersSkill(skillsRoot, candidate.name)
    },
  }

  ctx.skills.registerProvider(() => provider)

  if (!bootstrap) return

  // Load once at plugin apply; the preamble is static across the session.
  const preamble = loadBootstrapPreamble(skillsRoot)

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    // Agentless diagnostics carry no bootstrap; subagent sessions skip it.
    const agent = context.agent
    if (agent === undefined || agent.session.header.origin === 'subagent') {
      return next()
    }
    const result = await next()
    return {
      ...result,
      sections: [{ name: SECTION_NAME, text: preamble }, ...result.sections],
    }
  })
}

async function readSkillBundle(
  skillPath: string,
  dir: string,
  onSkip?: SkillSkipReporter,
): Promise<ParsedSkillFile | undefined> {
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
  if (parsed === undefined) {
    onSkip?.(`dsh-superpowers: skill at ${skillPath} ignored: missing or invalid YAML frontmatter`)
    return undefined
  }
  const skillName = parsed.data.name
  const description = parsed.data.description
  if (typeof skillName !== 'string' || typeof description !== 'string') {
    onSkip?.(`dsh-superpowers: skill at ${skillPath} ignored: frontmatter requires name and description`)
    return undefined
  }
  if (!isSkillName(skillName)) {
    onSkip?.(`dsh-superpowers: skill at ${skillPath} ignored: invalid skill name "${skillName}"`)
    return undefined
  }
  let invocation: SkillInvocationPolicy
  let tier: SkillTier | undefined
  try {
    invocation = parseInvocationPolicy(parsed.data)
    tier = parseSkillTier(parsed.data)
  } catch (error) {
    onSkip?.(
      `dsh-superpowers: skill at ${skillPath} ignored: invalid invocation or tier frontmatter:`
        + ` ${errorMessage(error)}`,
    )
    return undefined
  }
  return {
    name: skillName,
    description,
    whenToUse: resolveWhenToUse(parsed.data, description),
    body: parsed.body,
    dir,
    invocation,
    ...(tier !== undefined ? { tier } : {}),
  }
}

function toCandidate(parsed: ParsedSkillFile, skillPath: string): SkillCandidate {
  const locator: SuperpowersLocator = { path: skillPath, directory: parsed.dir }
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    invocation: parsed.invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: parsed.dir },
    rank: BUNDLED_SKILL_RANK,
    locator,
    ...(parsed.tier !== undefined ? { metadata: { tier: parsed.tier } } : {}),
  }
}

function toDefinition(parsed: ParsedSkillFile): SkillDefinition {
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    invocation: parsed.invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: parsed.dir },
    content: parsed.body,
    ...(parsed.tier !== undefined ? { metadata: { tier: parsed.tier } } : {}),
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

/**
 * Parse model/user invocation controls from skill frontmatter.
 * Defaults permit both surfaces when keys are omitted.
 *
 * This plugin-local helper intentionally mirrors current skill-filesystem
 * invocation semantics. It is compatibility code for frontmatter spelling —
 * not a new invocation policy, catalog filter, or routing layer. Catalog
 * exclusion continues to use the candidate's `invocation` fields via
 * registry / tool-skill (`isModelInvocable`).
 *
 * Return type uses the public {@link SkillInvocationPolicy} from
 * `@deepseek-ai/dsh-skill` (import only; this package does not redefine or
 * re-export the policy).
 *
 * @param data - parsed YAML frontmatter object.
 * @returns resolved invocation policy.
 * @throws when a known key is non-boolean or a legacy camelCase key is present.
 */
function parseInvocationPolicy(data: Record<string, unknown>): SkillInvocationPolicy {
  rejectLegacyInvocationKey(data, 'disableModelInvocation', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'modelInvocable', 'disable-model-invocation')
  rejectLegacyInvocationKey(data, 'userInvocable', 'user-invocable')
  // Opposite polarities match skill-filesystem (compatibility, not a new policy):
  // - disable-model-invocation: positive-disable (true = opt out of model catalog/tool)
  // - user-invocable: negative-disable (false = opt out of user gesture; omit/true = allow)
  const disableModelInvocation = frontmatterBoolean(data, 'disable-model-invocation')
  const userInvocable = frontmatterBoolean(data, 'user-invocable')
  return {
    modelInvocable: disableModelInvocation !== true,
    userInvocable: userInvocable !== false,
  }
}

/**
 * Parse optional top-level `tier` from skill frontmatter into metadata only.
 * `tier` is not priority, routing, loading, or execution policy.
 * @param data - parsed YAML frontmatter object.
 * @returns tier when present and valid; `undefined` when omitted.
 * @throws when `tier` is present but not a known {@link SkillTier} value.
 */
function parseSkillTier(data: Record<string, unknown>): SkillTier | undefined {
  if (!Object.hasOwn(data, 'tier')) return undefined
  const value = data.tier
  if (typeof value === 'string' && SKILL_TIERS.has(value)) {
    return value as SkillTier
  }
  throw new TypeError('frontmatter field "tier" must be one of: core, utility, session')
}

function rejectLegacyInvocationKey(data: Record<string, unknown>, legacy: string, canonical: string): void {
  if (Object.hasOwn(data, legacy)) {
    throw new Error(`frontmatter field "${legacy}" is unsupported; use "${canonical}"`)
  }
}

function frontmatterBoolean(data: Record<string, unknown>, key: string): boolean | undefined {
  if (!Object.hasOwn(data, key)) return undefined
  const value = data[key]
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1') return true
  if (value === 0 || value === '0') return false
  if (typeof value === 'string') {
    switch (value.toLowerCase()) {
      case 'true':
      case 'yes':
      case 'on':
        return true
      case 'false':
      case 'no':
      case 'off':
        return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asSuperpowersLocator(value: unknown): SuperpowersLocator | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  if (!('path' in value) || !('directory' in value)) return undefined
  const path = value.path
  const directory = value.directory
  if (typeof path !== 'string' || typeof directory !== 'string') return undefined
  return { path, directory }
}

/**
 * Whether the text contains a complete `{{...}}` group — the prompt renderer
 * would either substitute it as a variable or fail loud, so a section cannot
 * carry it. Mirrors skill-always-apply / the renderer's own scan.
 * @param text - candidate section text to inspect.
 * @returns true when any `{{` is closed by a later `}}`.
 */
function hasPromptVariableSyntax(text: string): boolean {
  for (let open = text.indexOf('{{'); open >= 0; open = text.indexOf('{{', open + 2)) {
    if (text.indexOf('}}', open + 2) >= 0) return true
  }
  return false
}

function readTextFileOrThrow(path: string, label: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(
      `dsh-superpowers: bootstrap ${label} missing at ${path}`,
      { cause: error },
    )
  }
}
