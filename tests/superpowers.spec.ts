import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId, createUserMessage, type GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { Inbox, agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry, { isModelInvocable } from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import type { SkillCatalogSource } from '@deepseek-ai/dsh-tool-skill'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Superpowers from '@firefly0621/dsh-superpowers'
import {
  assertSkillsRoot,
  buildBootstrapPreamble,
  listSuperpowersSkills,
  loadBootstrapPreamble,
  loadSuperpowersSkill,
  resolveSkillsRoot,
} from '@firefly0621/dsh-superpowers'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await rm(d, { recursive: true, force: true })
  }
})

/** Recursively list file paths under a skill directory, relative to that directory. */
async function listRelativePaths(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      out.push(...await listRelativePaths(join(dir, entry.name), relative))
      continue
    }
    if (entry.isFile()) out.push(relative)
  }
  return out
}

function waitForIdle(ctx: Context, agent: Agent): Promise<void> {
  return new Promise((resolve) => {
    const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
      if (subject === agent && status === 'idle') {
        dispose()
        resolve()
      }
    })
  })
}

/** Names from a durable skill-catalog message source (find() does not narrow MessageSource). */
function catalogEntryNames(source: { readonly kind: string }): string[] {
  if (source.kind !== 'skill-catalog') throw new Error('expected skill-catalog source')
  const catalog = source as unknown as SkillCatalogSource
  return catalog.entries.map(entry => entry.name)
}

/** Write a minimal skill bundle under a temp skills root for provider fixtures. */
async function writeBundle(
  root: string,
  name: string,
  frontmatter: string[],
  body = 'Body.',
): Promise<void> {
  await mkdir(join(root, name))
  await writeFile(join(root, name, 'SKILL.md'), [
    '---',
    `name: ${name}`,
    ...frontmatter,
    '---',
    '',
    body,
    '',
  ].join('\n'))
}

/** The rendered system prompt of one recorded request. */
function systemText(request: GenerateOptions): string {
  return request.system ?? ''
}

/** Durable user-message text; the bootstrap must not become conversation history. */
function userMessageTexts(agent: Agent): string[] {
  return [...agent.session.snapshotEvents()]
    .filter((e): e is SessionEvent<'user/message'> => e.type === 'user/message')
    .map(e => e.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
}

function superpowersCount(text: string): number {
  return (text.match(/You have superpowers\./g) ?? []).length
}

/** Positive routing segment: from "Use when" / "Use before" up to (but not including) "Do not use". */
function extractPositiveSegment(description: string): string {
  const lower = description.toLowerCase()
  const useWhen = lower.indexOf('use when')
  const useBefore = lower.indexOf('use before')
  let start = -1
  if (useWhen !== -1 && (useBefore === -1 || useWhen <= useBefore)) start = useWhen
  else if (useBefore !== -1) start = useBefore
  if (start === -1) return description
  const tail = description.slice(start)
  const doNot = tail.search(/\.\s*do not use/i)
  return doNot === -1 ? tail : tail.slice(0, doNot + 1)
}

/** Negative routing segment: from "Do not use" through end of description. */
function extractDoNotUseSegment(description: string): string {
  const lower = description.toLowerCase()
  const idx = lower.indexOf('do not use')
  if (idx === -1) return ''
  return description.slice(idx)
}

/** At least one alternative appears in text (case-insensitive). */
function matchesAny(text: string, alternatives: readonly string[]): boolean {
  const hay = text.toLowerCase()
  return alternatives.some(alt => hay.includes(alt.toLowerCase()))
}

/** Semantic description groups: each group needs one OR-alternative present (catalog contract). */
const SEMANTIC_DESCRIPTION_GROUPS: Record<string, Array<{ name: string; alternatives: readonly string[] }>> = {
  'incremental-implementation': [
    { name: 'maintenance', alternatives: ['multi-file maintenance', 'coordinated changes', 'plan task'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'impact-analysis': [
    { name: 'gate', alternatives: ['cross', 'boundary', 'boundaries', 'blast radius', 'package'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'code-simplification': [
    { name: 'quality', alternatives: ['readability', 'maintainability', 'structure', 'clarity'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'systematic-debugging': [
    { name: 'trigger', alternatives: ['bug', 'test failure', 'unexpected behavior'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'structured-refactoring': [
    { name: 'trigger', alternatives: ['architecture', 'coupling', 'seam', 'repeated'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'dsh-harness-contributor': [
    { name: 'trigger', alternatives: ['deepseek-harness', 'repository-specific', 'harness'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
  'explaining-changes': [
    { name: 'trigger', alternatives: ['why', 'teach-back', 'review'] },
    { name: 'negative', alternatives: ['Do not use'] },
  ],
}

/** Positive segment must not contain other-skill-domain trigger phrases (route contradiction). */
const NEGATIVE_BOUNDARY_BANNED: Record<string, readonly string[]> = {
  'code-simplification': [
    'fix bug', 'fix bugs', 'bug fix', 'maintenance repair', 'feature implementation', 'implement feature',
  ],
  'impact-analysis': [
    'direct implementation', 'coding steps', 'implementation design', 'simplify', 'refactor for clarity',
  ],
  'incremental-implementation': ['simplify', 'identical behavior'],
  'systematic-debugging': [
    'implementation protocol', 'refactoring-only', 'clarity improvement', 'identical behavior',
  ],
  'structured-refactoring': [
    'default completion', 'teach-back', 'harness behavior', 'deepseek-harness repository',
  ],
  'dsh-harness-contributor': [
    'identical behavior', 'clarity improvement', 'architecture wall', 'teach-back',
  ],
  'explaining-changes': [
    'fix bug', 'implement feature', 'cross-layer', 'blast radius', 'harness behavior',
  ],
}

/** incremental positive segment must not frame debugging/diagnosis as primary purpose. */
const INCREMENTAL_DEBUGGING_PRIMARY = [
  /debugging\s+as\s+primary/i,
  /diagnosis\s+as\s+primary/i,
  /primary\s+purpose\s+is\s+to\s+debug/i,
  /(?:debugging|diagnosis).{0,40}primary\s+purpose/i,
  /primary\s+purpose.{0,40}(?:debugging|diagnosis)/i,
] as const

/** Extension skills whose positive trigger phrases should not overlap (warn-only catalog hygiene). */
const NEW_SKILL_POSITIVE_OVERLAP = [
  'incremental-implementation',
  'impact-analysis',
  'code-simplification',
  'structured-refactoring',
  'dsh-harness-contributor',
  'explaining-changes',
] as const

describe('resolveSkillsRoot / assertSkillsRoot', () => {
  it('defaults to the packaged skills directory', () => {
    expect(resolveSkillsRoot()).toMatch(/skills[/\\]?$/)
    expect(() => { assertSkillsRoot(resolveSkillsRoot()) }).not.toThrow()
  })

  it('honors an explicit skillsRoot', () => {
    expect(resolveSkillsRoot({ skillsRoot: '/tmp/skills' })).toBe('/tmp/skills')
  })

  it('fails loud when the skills root is missing', () => {
    expect(() => { assertSkillsRoot(join(tmpdir(), 'dsh-superpowers-missing-root')) })
      .toThrow(/skills root missing/)
  })
})

describe('listSuperpowersSkills / loadSuperpowersSkill', () => {
  it('lists and loads the packaged Superpowers skill catalog', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    const names = listed.map(skill => skill.name)
    expect(names).toContain('using-superpowers')
    expect(names).toContain('brainstorming')
    expect(names).toContain('writing-plans')
    expect(names).toContain('test-driven-development')
    expect(names).toContain('incremental-implementation')
    expect(names).toContain('impact-analysis')
    expect(names).toContain('code-simplification')
    expect(names).toContain('structured-refactoring')
    expect(names).toContain('dsh-harness-contributor')
    expect(names).toContain('explaining-changes')
    expect(names).toHaveLength(29)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

    const loaded = await loadSuperpowersSkill(root, 'using-superpowers')
    expect(loaded?.provider).toBe('superpowers')
    expect(loaded?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(loaded?.content).toContain('Invoke relevant or requested skills')
    expect(loaded?.resourceBase).toEqual({
      kind: 'directory',
      path: join(root, 'using-superpowers'),
    })
  })

  it('loads packaged grilling as user-only with session tier', async () => {
    const root = resolveSkillsRoot()
    const grilling = await loadSuperpowersSkill(root, 'grilling')
    expect(grilling?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(grilling?.metadata).toEqual({ tier: 'session' })
    expect(grilling?.description).toContain('Do not use as a substitute for brainstorming')
    expect(grilling?.content).toContain('do not treat this skill as a required phase before `writing-plans`')
  })

  it('throws for a missing root and returns undefined for unknown names', async () => {
    await expect(listSuperpowersSkills(join(tmpdir(), 'dsh-superpowers-missing-root')))
      .rejects.toThrow(/skills root missing/)
    expect(await loadSuperpowersSkill(resolveSkillsRoot(), 'not-a-real-skill')).toBeUndefined()
    expect(await loadSuperpowersSkill(resolveSkillsRoot(), 'NotValid')).toBeUndefined()
  })

  it('skips malformed skill bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-'))
    dirs.push(root)
    await mkdir(join(root, 'ok-skill'))
    await writeFile(join(root, 'ok-skill', 'SKILL.md'), [
      '---',
      'name: ok-skill',
      'description: A valid fixture skill.',
      '---',
      '',
      'Do the thing.',
      '',
    ].join('\n'))
    await mkdir(join(root, 'routed-skill'))
    await writeFile(join(root, 'routed-skill', 'SKILL.md'), [
      '---',
      'name: routed-skill',
      'description: Short summary.',
      'whenToUse: Use when routing metadata is explicit.',
      '---',
      '',
      'Routed body.',
      '',
    ].join('\n'))
    await mkdir(join(root, 'broken'))
    await writeFile(join(root, 'broken', 'SKILL.md'), 'no frontmatter\n')
    await mkdir(join(root, 'empty-dir'))

    const skipped: string[] = []
    const listed = await listSuperpowersSkills(root, {
      onSkip: (message) => { skipped.push(message) },
    })
    expect(listed.map(skill => skill.name)).toEqual(['ok-skill', 'routed-skill'])
    expect(listed.find(skill => skill.name === 'ok-skill')?.whenToUse).toBe('A valid fixture skill.')
    expect(listed.find(skill => skill.name === 'routed-skill')?.whenToUse).toBe('Use when routing metadata is explicit.')
    expect(skipped.some(message => message.includes('broken') && message.includes('frontmatter'))).toBe(true)
  })

  it('skips directory/frontmatter name mismatches and loads listed skills via locator', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-mismatch-'))
    dirs.push(root)
    await writeBundle(root, 'ok-skill', ['description: Matched directory.'], 'Matched directory body.')
    await mkdir(join(root, 'dir-name'))
    await writeFile(join(root, 'dir-name', 'SKILL.md'), [
      '---',
      'name: other-name',
      'description: Directory and frontmatter disagree.',
      '---',
      '',
      'Should not catalog.',
      '',
    ].join('\n'))

    const skipped: string[] = []
    const listed = await listSuperpowersSkills(root, {
      onSkip: (message) => { skipped.push(message) },
    })
    expect(listed.map(skill => skill.name)).toEqual(['ok-skill'])
    expect(skipped.some(message => message.includes('dir-name') && message.includes('other-name'))).toBe(true)

    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Superpowers, { skillsRoot: root, bootstrap: false })
    const loaded = await ctx.skills.get('ok-skill')
    expect(loaded?.content).toContain('Matched directory body.')
    expect(loaded?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'ok-skill') })
  })
})

describe('invocation and tier frontmatter', () => {
  it('defaults invocation to model+user and omits tier metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-inv-'))
    dirs.push(root)
    await writeBundle(root, 'both-ok', ['description: Both surfaces.'])
    const listed = await listSuperpowersSkills(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect(listed[0]?.metadata).toBeUndefined()
  })

  it('honors disable-model-invocation and maps tier to metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-inv-'))
    dirs.push(root)
    await writeBundle(root, 'handoff', [
      'description: User-only handoff.',
      'disable-model-invocation: true',
      'tier: session',
    ])
    const listed = await listSuperpowersSkills(root)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    expect(listed[0]?.metadata).toEqual({ tier: 'session' })
  })

  it('honors string-form boolean invocation frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-inv-'))
    dirs.push(root)
    await writeBundle(root, 'string-bool', [
      'description: String booleans.',
      'disable-model-invocation: yes',
      'user-invocable: off',
    ])
    const listed = await listSuperpowersSkills(root)
    expect(listed[0]?.invocation).toEqual({ modelInvocable: false, userInvocable: false })
  })

  it('honors user-invocable false', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-inv-'))
    dirs.push(root)
    await writeBundle(root, 'model-only', [
      'description: Model-only.',
      'user-invocable: false',
      'tier: utility',
    ])
    const listed = await listSuperpowersSkills(root)
    expect(listed[0]?.invocation).toEqual({ modelInvocable: true, userInvocable: false })
    expect(listed[0]?.metadata).toEqual({ tier: 'utility' })
  })

  it('skips invalid invocation and invalid tier bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-inv-'))
    dirs.push(root)
    await writeBundle(root, 'bad-inv', [
      'description: Bad invocation.',
      'disable-model-invocation: maybe',
    ])
    await writeBundle(root, 'bad-legacy', [
      'description: Legacy key.',
      'disableModelInvocation: true',
    ])
    await writeBundle(root, 'bad-tier', [
      'description: Bad tier.',
      'tier: premium',
    ])
    await writeBundle(root, 'ok-skill', ['description: Valid.', 'tier: core'])
    const names = (await listSuperpowersSkills(root)).map(skill => skill.name)
    expect(names).toEqual(['ok-skill'])
    expect((await listSuperpowersSkills(root))[0]?.metadata).toEqual({ tier: 'core' })
  })
})

describe('model catalog with Superpowers invocation policy', () => {
  function agentForCatalog(): Agent {
    const id = SessionId('sp-catalog')
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: '/workspace', isSeeded: false })
    return {
      ctx: new Context(),
      id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      send: () => {},
      followup: () => {},
      steer: () => {},
      inject: () => { throw new Error('catalog test must not use agent.inject()') },
      cancel() {},
      runMaintenance: task => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    }
  }

  it('keeps user-only skills out of available_skills and refuses model load', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-cat-'))
    dirs.push(root)
    await writeBundle(root, 'both-ok', ['description: Both ok.'])
    await writeBundle(root, 'handoff', [
      'description: User-only handoff.',
      'disable-model-invocation: true',
      'tier: session',
    ])

    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(Superpowers, { skillsRoot: root, bootstrap: false })

    const listed = await ctx.skills.list()
    const modelNames = listed.filter(isModelInvocable).map(skill => skill.name)
    expect(modelNames).toContain('both-ok')
    expect(modelNames).not.toContain('handoff')

    const agent = agentForCatalog()
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    const catalogMessage = decision.messages.find(message => message.source.kind === 'skill-catalog')
    expect(catalogMessage).toBeDefined()
    const catalog = catalogEntryNames(catalogMessage!.source)
    expect(catalog).toContain('both-ok')
    expect(catalog).not.toContain('handoff')

    const refused = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('sp-handoff'),
      name: 'skill',
      arguments: { name: 'handoff' },
    })
    expect(refused.isError).toBe(true)
    const block = refused.content[0]
    if (block?.type !== 'text') throw new Error('expected text tool result')
    expect(block.text).toMatch(/skill ".*" is not available for model invocation/)
  })

  it('keeps packaged grilling and using-superpowers out of the model catalog', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(Superpowers, { bootstrap: false })

    const agent = agentForCatalog()
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [], turn: 1, step: 1, signal: new AbortController().signal },
      () => Promise.resolve({ kind: 'enter' as const, messages: [] }),
    )
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('expected enter')
    const catalogMessage = decision.messages.find(message => message.source.kind === 'skill-catalog')
    expect(catalogMessage).toBeDefined()
    const catalog = catalogEntryNames(catalogMessage!.source)
    for (const name of ['grilling', 'handoff', 'wait-what', 'using-superpowers'] as const) {
      expect(catalog).not.toContain(name)
      const refused = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: ToolCallId(`sp-${name}`),
        name: 'skill',
        arguments: { name },
      })
      expect(refused.isError).toBe(true)
      const block = refused.content[0]
      if (block?.type !== 'text') throw new Error('expected text tool result')
      expect(block.text).toMatch(/skill ".*" is not available for model invocation/)
    }

    const listed = await ctx.skills.list()
    const using = listed.find(skill => skill.name === 'using-superpowers')
    expect(using?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
  })
})

describe('buildBootstrapPreamble / loadBootstrapPreamble', () => {
  it('mirrors Superpowers SessionStart framing and appends the dsh adapter', () => {
    const text = buildBootstrapPreamble('---\nname: using-superpowers\n---\nbody', 'Use the skill tool.')
    expect(text).toContain('<EXTREMELY_IMPORTANT>')
    expect(text).toContain('You have superpowers.')
    expect(text).toContain('body')
    expect(text).toContain('DeepSeek Harness platform adaptation')
    expect(text).toContain('Use the skill tool.')
    expect(text).toContain('</EXTREMELY_IMPORTANT>')
  })

  it('loads the packaged using-superpowers skill and dsh adapter from disk', () => {
    const text = loadBootstrapPreamble(resolveSkillsRoot())
    expect(text).toContain('You have superpowers.')
    expect(text).toContain('Invoke relevant or requested skills')
    expect(text).toContain('DeepSeek Harness')
  })
})

describe('dsh-native skill content', () => {
  const foreignHarnessTokens = [
    'superpowers:',
    'Claude Code',
    'Codex',
    'Cursor',
    'Gemini CLI',
    'Antigravity',
    'Hermes',
    'Copilot CLI',
    'TodoWrite',
    '~/.claude',
    '~/.codex',
    '~/.gemini',
  ] as const

  it('keeps every skill file free of foreign-harness tool references', async () => {
    const root = resolveSkillsRoot()
    const offenders: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillDir = join(root, entry.name)
      for (const relative of await listRelativePaths(skillDir)) {
        const text = await readFile(join(skillDir, relative), 'utf8')
        if (foreignHarnessTokens.some(token => text.includes(token))) {
          offenders.push(`${entry.name}/${relative.replace(/\\/g, '/')}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('inlines Architectural grilling without loading grilling or one-at-a-time', async () => {
    const brainstorming = await readFile(join(resolveSkillsRoot(), 'brainstorming', 'SKILL.md'), 'utf8')
    expect(brainstorming).toContain('What would change this recommendation')
    expect(brainstorming).toContain('writing-plans')
    expect(brainstorming).toContain('Do **not** load, invoke, or delegate to the `grilling` skill')
    expect(brainstorming).toMatch(/Architectural:\*\* do \*\*not\*\* apply one-question-at-a-time/)
    const start = brainstorming.indexOf('**Architectural:**')
    const end = brainstorming.indexOf('## Process Flow')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const architecturalBlock = brainstorming.slice(start, end)
    expect(architecturalBlock).not.toMatch(/one at a time/i)
    expect(architecturalBlock).not.toContain('Only one question per message')
  })

  it('keeps using-superpowers priority short and anti-stack', async () => {
    const text = await readFile(join(resolveSkillsRoot(), 'using-superpowers', 'SKILL.md'), 'utf8')
    expect(text).toContain('Do not stack utilities or multiple core skills on trivial edits.')
    expect(text).toContain('Process spine first.')
    expect(text).toContain('No unresolved uncertainty')
    expect(text).toContain('Agent confidence is not evidence.')
    expect(text).toContain('systematic-debugging')
    expect(text).toContain('executing-plans')
    expect(text).toContain('incremental-implementation')
    expect(text).toContain('impact-analysis')
    expect(text).toContain('code-simplification')
    expect(text).toContain('structured-refactoring')
    expect(text).toContain('dsh-harness-contributor')
    expect(text).toContain('explaining-changes')
    expect(text).toContain('Contextual gates')
    expect(text).toContain('contextual guidance, not an automatic workflow')
  })

  it('keeps contextual gates out of implementation priority ranking', async () => {
    const text = await readFile(join(resolveSkillsRoot(), 'using-superpowers', 'SKILL.md'), 'utf8')
    const start = text.indexOf('### Implementation Priority')
    const end = text.indexOf('### Contextual gates')
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const priorityBlock = text.slice(start, end)
    for (const gate of ['structured-refactoring', 'dsh-harness-contributor', 'explaining-changes'] as const) {
      expect(priorityBlock, `${gate} belongs in contextual gates, not implementation priority`).not.toContain(gate)
    }
  })

  it('wires may recommend integrations for extension skill chain', async () => {
    const root = resolveSkillsRoot()
    const debugging = await readFile(join(root, 'systematic-debugging', 'SKILL.md'), 'utf8')
    expect(debugging).toContain('may recommend')
    expect(debugging).toContain('structured-refactoring')
    const design = await readFile(join(root, 'codebase-design', 'SKILL.md'), 'utf8')
    expect(design).toContain('may recommend')
    expect(design).toContain('structured-refactoring')
    const verify = await readFile(join(root, 'verification-before-completion', 'SKILL.md'), 'utf8')
    expect(verify).toContain('may recommend')
    expect(verify).toContain('dsh-harness-contributor')
    const receiving = await readFile(join(root, 'receiving-code-review', 'SKILL.md'), 'utf8')
    expect(receiving).toContain('may recommend')
    expect(receiving).toContain('explaining-changes')
    const finishing = await readFile(join(root, 'finishing-a-development-branch', 'SKILL.md'), 'utf8')
    expect(finishing).toContain('Harness verification matrix')
  })

  it('merges Matt discipline into TDD, debugging, and code review without duplicate skill dirs', async () => {
    const root = resolveSkillsRoot()
    for (const banned of ['tdd', 'diagnosing-bugs', 'code-review', 'grill-me']) {
      await expect(access(join(root, banned))).rejects.toThrow()
    }
    const tdd = await readFile(join(root, 'test-driven-development', 'SKILL.md'), 'utf8')
    expect(tdd).toContain('NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST')
    expect(tdd).toContain('Do not use for throwaway prototypes')
    expect(tdd).toContain('Implementation-coupled')
    expect(tdd).toContain('Tautological')
    expect(tdd).toContain('Horizontal slicing')
    expect(tdd).toContain('Refactor is part of this loop')
    expect(tdd).toContain('codebase-design')
    const debugging = await readFile(join(root, 'systematic-debugging', 'SKILL.md'), 'utf8')
    expect(debugging).toContain('<REDACTED>')
    expect(debugging).toContain('red-capable')
    expect(debugging).toContain('tight feedback loop')
    expect(debugging).toContain('Do not use for open-ended architecture')
    expect(debugging).toContain('Stop-the-Line Rule')
    expect(debugging).toContain('Untrusted Error Output')
    expect(debugging).toContain('Triage Checklist')
    const review = await readFile(join(root, 'requesting-code-review', 'SKILL.md'), 'utf8')
    expect(review).toContain('Standards')
    expect(review).toContain('Spec')
    expect(review).toContain('Fowler smell baseline')
    expect(review).toContain('verification-before-completion')
    expect(review).toContain('Do not use as a substitute for verifying your own changes')
    expect(review).not.toContain('docs/agents/issue-tracker.md')
  })

  it('ships core Matt skills with catalog negatives, tiers, and research budget', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    for (const name of ['domain-modeling', 'codebase-design', 'research'] as const) {
      const skill = listed.find(entry => entry.name === name)
      expect(skill, name).toBeDefined()
      expect(skill!.metadata).toEqual({ tier: 'core' })
      expect(skill!.description).toMatch(/Do not use/i)
      expect(skill!.invocation.modelInvocable).toBe(true)
    }
    await access(join(root, 'domain-modeling', 'CONTEXT-FORMAT.md'))
    await access(join(root, 'domain-modeling', 'ADR-FORMAT.md'))
    await access(join(root, 'codebase-design', 'DEEPENING.md'))
    await access(join(root, 'codebase-design', 'DESIGN-IT-TWICE.md'))
    const research = await readFile(join(root, 'research', 'SKILL.md'), 'utf8')
    expect(research).toContain('Max research rounds')
    expect(research).toContain('Max delegated agents')
    expect(research).toContain('Max primary sources **cited in the deliverable**')
    expect(research).toContain('Tool calls (search / fetch / read)')
    expect(research).toContain('No hard cap')
    expect(research).toContain('Cited sources ≠ tool calls')
    expect(research).toContain('Stop condition')
    expect(research).toContain('subagent')
    expect(research).not.toContain('background agent')
    const designTwice = await readFile(join(root, 'codebase-design', 'DESIGN-IT-TWICE.md'), 'utf8')
    expect(designTwice).toContain('subagent')
    expect(designTwice).not.toMatch(/sub-agent/)
  })

  it('ships utility and session Matt skills with hard boundaries and user-only session tier', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    for (const name of ['prototype', 'wizard', 'resolving-merge-conflicts'] as const) {
      const skill = listed.find(entry => entry.name === name)
      expect(skill, name).toBeDefined()
      expect(skill!.metadata).toEqual({ tier: 'utility' })
      expect(skill!.description).toMatch(/Do not use/i)
      expect(skill!.invocation.modelInvocable).toBe(true)
    }
    for (const name of ['handoff', 'wait-what'] as const) {
      const skill = listed.find(entry => entry.name === name)
      expect(skill, name).toBeDefined()
      expect(skill!.metadata).toEqual({ tier: 'session' })
      expect(skill!.invocation).toEqual({ modelInvocable: false, userInvocable: true })
      expect(skill!.description).toMatch(/Do not use/i)
    }
    const prototype = await readFile(join(root, 'prototype', 'SKILL.md'), 'utf8')
    expect(prototype).toContain('## Hard boundary')
    expect(prototype).toContain('substitute for `writing-plans`')
    await access(join(root, 'prototype', 'LOGIC.md'))
    await access(join(root, 'prototype', 'UI.md'))
    await access(join(root, 'wizard', 'template.sh'))
    const withTier = listed.filter(skill => skill.metadata?.tier !== undefined).map(skill => skill.name).sort()
    expect(withTier).toEqual([
      'codebase-design',
      'domain-modeling',
      'grilling',
      'handoff',
      'prototype',
      'research',
      'resolving-merge-conflicts',
      'wait-what',
      'wizard',
    ])
  })

  it('ships a platform adapter deep enough for SDD and parallel dispatch', async () => {
    const text = await readFile(
      join(resolveSkillsRoot(), 'using-superpowers', 'references', 'dsh-tools.md'),
      'utf8',
    )
    for (const required of [
      '## Waiting on children',
      '## Fix rounds and resume',
      '## Model routing on spawns',
      '## Environment detection',
      '## Detect deepseek-harness repository',
      '## Harness verification matrix',
      'send_message',
      'list_agents',
      'settlement',
      'subagent_fork',
      'run_in_background',
      'system-prompt section',
      'End this turn',
      'subagent-settled',
      'not a wait',
    ]) {
      expect(text, `dsh-tools.md must document ${required}`).toContain(required)
    }
    expect(text).not.toMatch(/continue the turn only after reconciling:\s*call `list_agents`/i)
    expect(text).not.toMatch(/minutes of real wall time between status checks/i)
  })

  it('keeps SDD waiting on settlement delivery, not list_agents polling', async () => {
    const text = await readFile(
      join(resolveSkillsRoot(), 'subagent-driven-development', 'SKILL.md'),
      'utf8',
    )
    expect(text).toMatch(/Waiting on dispatched subagents/i)
    expect(text).toContain('end this turn')
    expect(text).toContain('settlement notice')
    expect(text).toMatch(/Do \*\*not\*\* call `list_agents` to\s+wait/i)
    expect(text).not.toMatch(/bounded stretches \(five to ten\s*minutes/i)
    expect(text).not.toMatch(/reconcile your live children:\s*list them/i)
  })
})

describe('catalog description contracts', () => {
  it('requires semantic description groups on gated skills', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    const missing: string[] = []
    for (const [skillName, groups] of Object.entries(SEMANTIC_DESCRIPTION_GROUPS)) {
      const skill = listed.find(entry => entry.name === skillName)
      expect(skill, skillName).toBeDefined()
      const description = skill!.description
      for (const group of groups) {
        if (!matchesAny(description, group.alternatives)) {
          missing.push(`${skillName}: missing semantic group "${group.name}" (${group.alternatives.join(' | ')})`)
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('rejects positive-segment route contradictions (negative boundary)', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    const violations: string[] = []
    for (const [skillName, banned] of Object.entries(NEGATIVE_BOUNDARY_BANNED)) {
      const skill = listed.find(entry => entry.name === skillName)
      expect(skill, skillName).toBeDefined()
      const positive = extractPositiveSegment(skill!.description)
      for (const phrase of banned) {
        if (new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(positive)) {
          violations.push(`${skillName}: positive segment must not contain "${phrase}"`)
        }
      }
      if (skillName === 'incremental-implementation') {
        for (const pattern of INCREMENTAL_DEBUGGING_PRIMARY) {
          if (pattern.test(positive)) {
            violations.push(`${skillName}: positive segment frames debugging/diagnosis as primary purpose (${pattern})`)
          }
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('extractPositiveSegment handles Use before descriptions', async () => {
    const root = resolveSkillsRoot()
    const impact = (await listSuperpowersSkills(root)).find(s => s.name === 'impact-analysis')
    expect(impact).toBeDefined()
    const positive = extractPositiveSegment(impact!.description)
    expect(positive.toLowerCase()).toMatch(/^use before/)
    expect(positive.toLowerCase()).not.toContain('do not use')
  })

  it('documents description boundaries for new extension skills', async () => {
    const listed = await listSuperpowersSkills(resolveSkillsRoot())
    const structured = listed.find(s => s.name === 'structured-refactoring')!
    const contributor = listed.find(s => s.name === 'dsh-harness-contributor')!
    const incremental = listed.find(s => s.name === 'incremental-implementation')!

    const structuredPositive = extractPositiveSegment(structured.description)
    const structuredDoNotUse = extractDoNotUseSegment(structured.description)
    expect(structuredPositive).toMatch(/architecture|repeated|coupling|seam/i)
    expect(structuredDoNotUse).toMatch(/identical behavior|root cause|large/i)

    expect(extractPositiveSegment(contributor.description)).toContain('deepseek-harness')
    expect(extractDoNotUseSegment(incremental.description).toLowerCase()).not.toContain('harness behavior')
  })

  it('warns on positive trigger phrase overlap among new skills', async () => {
    const root = resolveSkillsRoot()
    const listed = await listSuperpowersSkills(root)
    const positives = NEW_SKILL_POSITIVE_OVERLAP.map(name => ({
      name,
      segment: extractPositiveSegment(listed.find(s => s.name === name)!.description).toLowerCase(),
    }))
    const overlaps: string[] = []
    for (let i = 0; i < positives.length; i++) {
      for (let j = i + 1; j < positives.length; j++) {
        const a = positives[i]!
        const b = positives[j]!
        const aWords = a.segment.split(/\W+/).filter(w => w.length > 4)
        const shared = aWords.filter(w => b.segment.includes(w))
        if (shared.length >= 3) {
          overlaps.push(`${a.name} ↔ ${b.name}: shared triggers [${[...new Set(shared)].slice(0, 5).join(', ')}]`)
        }
      }
    }
    if (overlaps.length > 0) {
      // eslint-disable-next-line no-console -- catalog hygiene signal; warn-only by design
      console.warn(`Positive trigger overlap (warn-only):\n${overlaps.join('\n')}`)
    }
  })
})

describe('package composition contracts', () => {
  it('exports a function plugin namespace with no default export', async () => {
    const mod = await import('@firefly0621/dsh-superpowers')
    expect(mod.name).toBe('superpowers')
    expect(mod.inject).toEqual(['skills'])
    expect(mod.apply).toEqual(expect.any(Function))
    expect('default' in mod && mod.default).toBeFalsy()
  })

  it('ships an insert-only overlay patch naming this package', async () => {
    const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
    const patches = loadOverlayPatches('superpowers-test', patchPath)
    expect(patches).toHaveLength(1)
    expect(patches[0]?.insert).toEqual([
      {
        id: 'superpowers',
        name: '@firefly0621/dsh-superpowers',
      },
    ])
    const raw = await readFile(patchPath, 'utf8')
    expect(raw).not.toMatch(/^\s*- id: skill-filesystem\b/m)
  })

  it('declares the packaged skills payload and license attribution for npm publish', async () => {
    const pkg = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      version: string
      files: string[]
      repository: { url: string }
      dsh: { bundle: { patch: string } }
    }
    // Pin the published package version so README "currently …" and npm publish stay in lockstep.
    expect(pkg.version).toBe('0.1.0-rc.22')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.files).toEqual([
      'lib/index.js',
      'lib/invariant.js',
      'cordis.patch.yml',
      'assets',
      'skills',
      'lib/types/**/*.d.ts',
    ])
    expect(pkg.repository.url).toBe('git+https://github.com/oThTJx/dsh-superpowers.git')
    await access(join(packageRoot, 'skills/using-superpowers/SKILL.md'))
    await access(join(packageRoot, 'skills/using-superpowers/references/dsh-tools.md'))
    await access(join(packageRoot, 'assets/NOTICE.md'))
    const notice = await readFile(join(packageRoot, 'assets/NOTICE.md'), 'utf8')
    expect(notice).toContain('Jesse Vincent')
    expect(notice).toContain('b36e0829')
    expect(notice).toContain('Matt Pocock')
    expect(notice).toContain('mattpocock/skills')
  })

  it('documents system-prompt bootstrap rather than session-start inject', async () => {
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8')
    expect(readme).toContain('system-prompt/assemble')
    expect(readme).not.toContain('agent/session-start')
    expect(readme).not.toContain('agent.inject()')
    const readmeZh = await readFile(join(packageRoot, 'README.zh.md'), 'utf8')
    expect(readmeZh).toContain('system-prompt/assemble')
    expect(readmeZh).not.toContain('agent/session-start')
    expect(readmeZh).not.toContain('agent.inject()')
  })
})

describe('dsh-superpowers plugin', () => {
  it('registers vendored skills on ctx.skills and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await mountAgentLoopTestDependencies(ctx)
    const fiber = await ctx.plugin(Superpowers)

    const names = (await ctx.skills.list()).map(skill => skill.name)
    expect(names).toContain('brainstorming')
    expect(names).toContain('using-superpowers')
    const loaded = await ctx.skills.get('brainstorming')
    expect(loaded?.provider).toBe('superpowers')
    expect(loaded?.content.length).toBeGreaterThan(0)

    await fiber.dispose()
    expect(await ctx.skills.list()).toEqual([])
  })

  it('fails loud at apply when skillsRoot is missing', async () => {
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(Superpowers, {
      skillsRoot: join(tmpdir(), 'dsh-superpowers-missing-apply'),
    })).rejects.toThrow(/skills root missing/)
  })

  it('fails loud at apply when bootstrap files are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-empty-boot-'))
    dirs.push(root)
    await writeBundle(root, 'placeholder', ['description: No using-superpowers here.'])
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(Superpowers, { skillsRoot: root })).rejects.toThrow(
      /bootstrap using-superpowers SKILL\.md missing/,
    )
  })

  it('fails loud at apply when bootstrap preamble contains prompt-variable syntax', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-superpowers-var-boot-'))
    dirs.push(root)
    await mkdir(join(root, 'using-superpowers', 'references'), { recursive: true })
    await writeFile(join(root, 'using-superpowers', 'SKILL.md'), [
      '---',
      'name: using-superpowers',
      'description: Bootstrap with a forbidden complete group.',
      '---',
      '',
      'Hello {{name}}.',
      '',
    ].join('\n'))
    await writeFile(join(root, 'using-superpowers', 'references', 'dsh-tools.md'), 'adapter\n')
    const ctx = new Context()
    await ctx.plugin(SkillRegistry)
    await mountAgentLoopTestDependencies(ctx)
    await expect(ctx.plugin(Superpowers, { skillsRoot: root })).rejects.toThrow(
      /\{\{\.\.\.\}\} prompt-variable syntax/,
    )
  })

  it('stops injecting bootstrap after the plugin fiber is disposed', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    const fiber = await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)

    await fiber.dispose()
    const agent = await ctx.agentLoop.create(SessionId('sp-dispose'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(systemText(adapter.requests[0]!)).not.toContain('You have superpowers.')
  })

  it('injects the Superpowers bootstrap into the system prompt', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = await ctx.agentLoop.create(SessionId('sp-boot'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const system = systemText(adapter.requests[0]!)
    expect(superpowersCount(system)).toBe(1)
    expect(system).toContain('using-superpowers')
    expect(system).toContain('DeepSeek Harness')
    expect(userMessageTexts(agent).join('\n')).not.toContain('You have superpowers.')

    const catalog = await ctx.skills.list()
    expect(catalog.some(skill => skill.name === 'brainstorming')).toBe(true)
  })

  it('skips bootstrap when bootstrap is disabled', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Superpowers, { bootstrap: false })
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = await ctx.agentLoop.create(SessionId('sp-off'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    expect(systemText(adapter.requests[0]!)).not.toContain('You have superpowers.')
  })

  it('skips bootstrap for subagent-origin sessions', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const handle = await ctx.agentLoop.createAgent(ctx, {
      sessionId: SessionId('sp-child'),
      meta: { origin: 'subagent' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    expect(handle.agent.session.header.origin).toBe('subagent')
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'task' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, handle.agent)

    expect(systemText(adapter.requests[0]!)).not.toContain('You have superpowers.')
  })

  it('keeps the bootstrap in every step without duplication', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = await ctx.agentLoop.create(SessionId('sp-every-step'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    for (const request of adapter.requests) {
      expect(superpowersCount(systemText(request))).toBe(1)
    }
    expect(userMessageTexts(agent).join('\n')).not.toContain('You have superpowers.')
  })
})

describe('skill composition contracts', () => {
  const MATT = [
    'codebase-design',
    'domain-modeling',
    'grilling',
    'handoff',
    'prototype',
    'research',
    'resolving-merge-conflicts',
    'wait-what',
    'wizard',
  ] as const

  it('keeps metadata.tier inventory exactly the frozen nine Matt skills', async () => {
    const listed = await listSuperpowersSkills(resolveSkillsRoot())
    const withTier = listed.filter(skill => skill.metadata?.tier != null)
    expect(withTier.map(skill => skill.name).sort()).toEqual([...MATT].sort())
    for (const skill of withTier) {
      expect(['core', 'utility', 'session']).toContain(skill.metadata!.tier)
    }
    expect(listed.map(skill => skill.name)).toContain('brainstorming')
    expect(listed.find(skill => skill.name === 'brainstorming')?.metadata?.tier).toBeUndefined()
  })

  it('locks Architectural → writing-plans without model grilling dependency', async () => {
    const brainstorming = await readFile(join(resolveSkillsRoot(), 'brainstorming', 'SKILL.md'), 'utf8')
    expect(brainstorming).toContain('writing-plans')
    expect(brainstorming).toContain('Do **not** load, invoke, or delegate to the `grilling` skill')
  })

  it('locks the packaged catalog at twenty-nine skills', async () => {
    const names = (await listSuperpowersSkills(resolveSkillsRoot())).map(skill => skill.name)
    expect(names).toHaveLength(29)
    for (const name of [
      'incremental-implementation',
      'impact-analysis',
      'code-simplification',
      'structured-refactoring',
      'dsh-harness-contributor',
      'explaining-changes',
    ] as const) {
      expect(names).toContain(name)
    }
  })

  it('keeps sole TDD/debug/review skill names', async () => {
    const root = resolveSkillsRoot()
    const names = (await listSuperpowersSkills(root)).map(skill => skill.name)
    expect(names).toContain('test-driven-development')
    expect(names).toContain('systematic-debugging')
    expect(names).toContain('requesting-code-review')
    expect(names).not.toContain('tdd')
    expect(names).not.toContain('diagnosing-bugs')
    expect(names).not.toContain('code-review')
  })

  it('does not positively route a trivial rename onto Matt stacking skills', async () => {
    const using = await readFile(join(resolveSkillsRoot(), 'using-superpowers', 'SKILL.md'), 'utf8')
    expect(using).toContain('Do not stack utilities or multiple core skills on trivial edits.')
    const rename = 'Rename this variable from foo to bar.'
    expect(using, 'trivial-task fixture must appear in Skill Priority').toContain(rename)
    const start = using.indexOf(rename)
    expect(start).toBeGreaterThanOrEqual(0)
    const window = using.slice(start, start + 280)
    expect(window).toMatch(/do not stack/i)
    for (const skill of ['grilling', 'domain-modeling', 'codebase-design', 'research', 'prototype'] as const) {
      expect(window, `fixture window must mention ${skill} as a negative`).toContain(skill)
      expect(window, `must not positively load/invoke ${skill} for rename`).not.toMatch(
        new RegExp(`(?:load|invoke|use)\\s+(?:the\\s+)?\`?${skill}\`?`, 'i'),
      )
    }
  })
})
