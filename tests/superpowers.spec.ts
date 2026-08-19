import { mkdtemp, mkdir, writeFile, readFile, rm, access, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import * as Superpowers from '@firefly0621/dsh-skill-superpowers'
import {
  assertSkillsRoot,
  buildBootstrapPreamble,
  listSuperpowersSkills,
  loadBootstrapPreamble,
  loadSuperpowersSkill,
  resolveSkillsRoot,
  sessionHasSuperpowersBootstrap,
  sessionHasSuperpowersBootstrapVisible,
} from '@firefly0621/dsh-skill-superpowers'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) {
    await rm(d, { recursive: true, force: true })
  }
})

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

function pluginMessages(agent: Agent): string[] {
  return [...agent.session.events]
    .filter((e): e is SessionEvent<'user/message'> =>
      e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'superpowers')
    .map(e => e.data.content.map(block => block.type === 'text' ? block.text : '').join(''))
}

describe('resolveSkillsRoot / assertSkillsRoot', () => {
  it('defaults to the packaged skills directory', () => {
    expect(resolveSkillsRoot()).toMatch(/skills[/\\]?$/)
    expect(() => { assertSkillsRoot(resolveSkillsRoot()) }).not.toThrow()
  })

  it('honors an explicit skillsRoot', () => {
    expect(resolveSkillsRoot({ skillsRoot: '/tmp/skills' })).toBe('/tmp/skills')
  })

  it('fails loud when the skills root is missing', () => {
    expect(() => { assertSkillsRoot(join(tmpdir(), 'dsh-skill-superpowers-missing-root')) })
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
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))

    const loaded = await loadSuperpowersSkill(root, 'using-superpowers')
    expect(loaded?.provider).toBe('superpowers')
    expect(loaded?.content).toContain('Invoke relevant or requested skills')
    expect(loaded?.resourceBase).toEqual({
      kind: 'directory',
      path: join(root, 'using-superpowers'),
    })
  })

  it('throws for a missing root and returns undefined for unknown names', async () => {
    await expect(listSuperpowersSkills(join(tmpdir(), 'dsh-skill-superpowers-missing-root')))
      .rejects.toThrow(/skills root missing/)
    expect(await loadSuperpowersSkill(resolveSkillsRoot(), 'not-a-real-skill')).toBeUndefined()
    expect(await loadSuperpowersSkill(resolveSkillsRoot(), 'NotValid')).toBeUndefined()
  })

  it('skips malformed skill bundles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-superpowers-'))
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

    const listed = await listSuperpowersSkills(root)
    expect(listed.map(skill => skill.name)).toEqual(['ok-skill', 'routed-skill'])
    expect(listed.find(skill => skill.name === 'ok-skill')?.whenToUse).toBe('A valid fixture skill.')
    expect(listed.find(skill => skill.name === 'routed-skill')?.whenToUse).toBe('Use when routing metadata is explicit.')
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
  it('keeps every SKILL.md free of foreign-harness tool references', async () => {
    const root = resolveSkillsRoot()
    const forbidden = [
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
    ]
    const offenders: string[] = []
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillPath = join(root, entry.name, 'SKILL.md')
      try {
        await access(skillPath)
      } catch {
        continue
      }
      const text = await readFile(skillPath, 'utf8')
      if (forbidden.some(token => text.includes(token))) offenders.push(entry.name)
    }
    expect(offenders).toEqual([])
  })
})

describe('package composition contracts', () => {
  it('exports a function plugin namespace with no default export', async () => {
    const mod = await import('@firefly0621/dsh-skill-superpowers')
    expect(mod.name).toBe('skill-superpowers')
    expect(mod.inject).toEqual(['skills', 'agents'])
    expect(mod.apply).toEqual(expect.any(Function))
    expect('default' in mod && mod.default).toBeFalsy()
  })

  it('ships an insert-only overlay patch naming this package', async () => {
    const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
    const patches = loadOverlayPatches('superpowers-test', patchPath)
    expect(patches).toHaveLength(1)
    expect(patches[0]?.insert).toEqual([
      {
        id: 'skill-superpowers',
        name: '@firefly0621/dsh-skill-superpowers',
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
    expect(pkg.version).toBe('0.1.0-rc.10')
    expect(pkg.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(pkg.files).toEqual([
      'lib/index.js',
      'lib/invariant.js',
      'cordis.patch.yml',
      'assets',
      'skills',
      'lib/types/**/*.d.ts',
    ])
    expect(pkg.repository.url).toBe('git+https://github.com/oThTJx/dsh-skill-superpowers.git')
    await access(join(packageRoot, 'skills/using-superpowers/SKILL.md'))
    await access(join(packageRoot, 'skills/using-superpowers/references/dsh-tools.md'))
    await access(join(packageRoot, 'assets/NOTICE.md'))
    const notice = await readFile(join(packageRoot, 'assets/NOTICE.md'), 'utf8')
    expect(notice).toContain('Jesse Vincent')
    expect(notice).toContain('b36e0829')
  })
})

describe('dsh-skill-superpowers plugin', () => {
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
      skillsRoot: join(tmpdir(), 'dsh-skill-superpowers-missing-apply'),
    })).rejects.toThrow(/skills root missing/)
  })

  it('injects the Superpowers bootstrap on session start with tool-skill mounted', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ToolSkill)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('ok')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('sp-boot'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)

    const injected = pluginMessages(agent)
    expect(injected).toHaveLength(1)
    expect(injected[0]).toContain('You have superpowers.')
    expect(injected[0]).toContain('using-superpowers')
    expect(injected[0]).toContain('DeepSeek Harness')
    expect(sessionHasSuperpowersBootstrap(agent)).toBe(true)
    expect(JSON.stringify(adapter.requests[0]!.messages)).toContain('You have superpowers.')

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

    const agent = ctx.agentLoop.create(SessionId('sp-off'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(pluginMessages(agent)).toEqual([])
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
    expect(pluginMessages(handle.agent)).toEqual([])
  })

  it('does not re-inject bootstrap when resuming a session that already has it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-skill-superpowers-resume-'))
    dirs.push(root)
    const sessionId = SessionId('sp-resume')
    const preamble = loadBootstrapPreamble(resolveSkillsRoot())

    const adapter1 = new MockAdapter([])
    const ctx1 = new Context()
    await mountAgentLoopTestDependencies(ctx1)
    await ctx1.plugin(AgentLoop, { agents: [] })
    await ctx1.plugin(JsonlSessionPersistence, { root })
    ctx1.llm.registerAdapter(['mock'], adapter1)

    const seed: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      {
        type: 'user/message',
        seq: 1,
        time: 2,
        data: createUserMessage({
          content: [{ type: 'text', text: preamble }],
          source: { kind: 'plugin', plugin: 'superpowers', form: 'instructions' },
        }),
        surfaceOp: 'append',
      },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    const session = ctx1.sessions.create(sessionId, { seed })
    await ctx1.sessions.flush(session)
    await ctx1.fiber.dispose()

    const adapter2 = new MockAdapter([textResponse('second')])
    const ctx2 = new Context()
    await mountAgentLoopTestDependencies(ctx2)
    await ctx2.plugin(AgentLoop, { agents: [] })
    await ctx2.plugin(JsonlSessionPersistence, { root })
    await ctx2.plugin(SkillRegistry)
    await ctx2.plugin(Superpowers)
    ctx2.llm.registerAdapter(['mock'], adapter2)

    const a2 = (await ctx2.agents.resume({
      resumeSessionId: sessionId,
      agentOptions: { provider: 'mock', model: 'mock' },
    })).agent
    expect(sessionHasSuperpowersBootstrap(a2)).toBe(true)
    expect(pluginMessages(a2)).toHaveLength(1)
    a2.followup(createUserMessage({ content: [{ type: 'text', text: 'again' }], source: { kind: 'user' } }))
    await waitForIdle(ctx2, a2)
    expect(pluginMessages(a2)).toHaveLength(1)
    await ctx2.fiber.dispose()
  })

  it('does not duplicate the bootstrap while it stays visible', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('sp-once'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(pluginMessages(agent)).toHaveLength(1)
    expect(sessionHasSuperpowersBootstrapVisible(agent)).toBe(true)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(pluginMessages(agent)).toHaveLength(1)
    expect(sessionHasSuperpowersBootstrapVisible(agent)).toBe(true)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('You have superpowers.')
  })

  it('re-injects the bootstrap after it leaves the model-visible surface', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(Superpowers)
    const adapter = new MockAdapter([textResponse('one'), textResponse('two')])
    ctx.llm.registerAdapter(['mock'], adapter)

    const agent = ctx.agentLoop.create(SessionId('sp-reinject'), { provider: 'mock', model: 'mock' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'first' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(pluginMessages(agent)).toHaveLength(1)
    expect(sessionHasSuperpowersBootstrapVisible(agent)).toBe(true)

    // Compaction-style replacement shadows the bootstrap node.
    const bootSeq = [...agent.session.events].find(
      (e): e is SessionEvent<'user/message'> =>
        e.type === 'user/message' && e.data.source.kind === 'plugin' && e.data.source.plugin === 'superpowers',
    )?.seq
    expect(bootSeq).toEqual(expect.any(Number))
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: '[compacted prior bootstrap]' }],
      source: { kind: 'plugin', plugin: 'test-compact' },
    }), {
      surfaceOp: { op: 'replace', start: bootSeq!, end: bootSeq! },
      sourceEventSeqs: [bootSeq!],
    })
    expect(sessionHasSuperpowersBootstrap(agent)).toBe(true)
    expect(sessionHasSuperpowersBootstrapVisible(agent)).toBe(false)

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'second' }], source: { kind: 'user' } }))
    await waitForIdle(ctx, agent)
    expect(pluginMessages(agent)).toHaveLength(2)
    expect(sessionHasSuperpowersBootstrapVisible(agent)).toBe(true)
    expect(JSON.stringify(adapter.requests[1]!.messages)).toContain('You have superpowers.')
  })
})
