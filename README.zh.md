# @firefly0621/dsh-superpowers

[English](README.md) | 中文

可安装的 DeepSeek Harness 插件组合包：把 [obra/superpowers](https://github.com/obra/superpowers) 接入产品会话——完整 skill 库（已适配 dsh 工具）+ 等价于 SessionStart 的引导注入。

发布名：`@firefly0621/dsh-superpowers`（版本跟随 harness 家族，当前为 `0.1.0-rc.21`）。本 fork 包的源码真源：[github.com/oThTJx/dsh-superpowers](https://github.com/oThTJx/dsh-superpowers)。本包为显式 opt-in，不属于官方 main 的 `dsh-base` 组合。

## 还原的能力

| Superpowers 行为 | dsh 实现 |
|---|---|
| `skills/*/SKILL.md` 技能库 | `ctx.skills` 提供方 `superpowers`（打包的 `skills/` 目录，已适配 dsh） |
| SessionStart 注入 `using-superpowers` | `system-prompt/assemble` 段 `skill:superpowers`，同一套 `<EXTREMELY_IMPORTANT>` 框架（每个非 subagent 请求）；`using-superpowers` 在 skill 目录中为仅用户 |
| 平台 `references/*-tools.md` | 该段内附加 `skills/using-superpowers/references/dsh-tools.md` |
| 子代理跳过（`SUBAGENT-STOP`） | `session.header.origin === 'subagent'` 时不引导 |
| 按需加载其他 skill | 现有 `dsh-tool-skill` 目录 + `skill` 工具 |

skill 正文以 dsh 适配后的形式随包发布在 `skills/` 下（无 vendored 源码、无 git submodule）：外 harness 工具名与平台引用已改写为 dsh 等价物，`superpowers:` 前缀已移除。发布 tarball 包含 `skills/` 与 `assets/NOTICE.md`（记录 obra/superpowers @ `b36e0829` v6.3.0，以及 mattpocock/skills 的 MIT 出处，Copyright 2026 Matt Pocock）。

## Matt skills（能力扩展）

Superpowers 仍是工作流内核（`brainstorming` → `writing-plans` → TDD / 调试 / 评审 / 验证）。从 [mattpocock/skills](https://github.com/mattpocock/skills) 选取的实践以**冻结的九个 skill** 作为能力扩展（不含 tracker 生态，也不新建 `tdd` / `diagnosing-bugs` / `code-review` / `grill-me` 等同名 skill）。

| 层级（`metadata.tier`） | Skills | 说明 |
|---|---|---|
| `core` | `domain-modeling`、`codebase-design`、`research` | 模型 + 用户 |
| `utility` | `prototype`、`wizard`、`resolving-merge-conflicts` | 模型 + 用户；prototype 为硬性可抛弃边界 |
| `session` | `grilling`、`handoff`、`wait-what` | **仅用户**（`disable-model-invocation: true`） |

session skill（`grilling`、`handoff`、`wait-what`）不会出现在模型的 `<available_skills>` 目录中，模型侧 `skill` 工具也会拒绝加载。用户在用户消息里用空白边界的 `/name` token 调用（例如 `/grilling`）；由 `dsh-tool-skill` 注入 skill 正文。`using-superpowers` 同样是 `disable-model-invocation: true`，但其常驻正文来自系统提示词引导，而非该手势（用户仍可用 `/using-superpowers` 重载正文，但不含 adapter）。

吸收了 Matt 合并内容的 obra skill（obra 同步时需保留）：`brainstorming`（Architectural 内联 grilling）、`using-superpowers`（短反堆叠优先级、tiny-edit 路径、实现优先级、contextual gates）、`test-driven-development`、`systematic-debugging`（Stop-the-line、不可信错误输出、triage）、`requesting-code-review`。

Superpowers 扩展 skill（实现纪律，非自动路由）：`incremental-implementation`、`impact-analysis`、`code-simplification`、`structured-refactoring`、`dsh-harness-contributor`、`explaining-changes`。引导 skill `using-superpowers` 定义何时加载、实现优先级与 contextual gates；`tier` 与目录 description 不会自动路由。

`tier` 仅为目录元数据，不是路由器。本提供方在插件内私有解析 invocation / `tier` frontmatter（仅改插件；不改上游 harness 包）。

## 安装进 dsh profile

需要 DeepSeek Harness peer 为 `^0.1.0-rc.5`（`@deepseek-ai/dsh-skill` 等），通常来自官方 CLI / `dsh-base` 栈。

```sh
dsh plugin --profile web add @firefly0621/dsh-superpowers
```

源码树中：

```sh
pnpm dsh plugin --profile web add @firefly0621/dsh-superpowers
```

然后启动 `dsh --profile web`（或 `pnpm dsh web`）。若本 fork 的 `dsh-base` 已挂载 `id: superpowers`，不要再重复安装——先禁用 base 行，或使用不含该行的 profile。

### 本地 / 发布前自检

```sh
pnpm run build:lib:host
pnpm --filter @firefly0621/dsh-superpowers pack
pnpm dsh plugin --profile superpowers-demo add ./firefly0621-dsh-superpowers-0.1.0-rc.21.tgz
```

（`pnpm pack` 默认把 tarball 写到仓库根目录。包本身没有 `build` script；由 host lib 构建产出 `lib/`。）

## 在本 monorepo 中启用（不经过 npm）

本包在 harness 源码树中为 opt-in。挂载随包 overlay patch（或 `dsh plugin add`）：

```sh
pnpm dsh web --patch packages/skill/superpowers/cordis.patch.yml
pnpm dsh --profile headless --patch packages/skill/superpowers/cordis.patch.yml "task"
```

已在 base 中挂载 `id: superpowers` 的 fork 树无需再加一层；若要省略，在该行上设置 `disabled: true`。

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `skillsRoot` | 打包的 `skills/` 目录 | skill 根目录 |
| `bootstrap` | `true` | 将 `using-superpowers`（+ dsh 适配）贡献为 `skill:superpowers` 系统提示词 section |

## 更新 Superpowers

不再保留 vendored 子模块。若要移植更新的 obra/superpowers 版本：对照记录的上游 commit（`b36e0829`，v6.3.0）diff 上游 `skills/`，再手工重放 dsh 适配——替换外 harness 工具名与平台引用、移除 `superpowers:` 前缀，行为内容保持逐字。

**obra 同步时需保留：** Matt 新增的 skill 目录（`domain-modeling`、`codebase-design`、`research`、`prototype`、`wizard`、`resolving-merge-conflicts`、`grilling`、`handoff`、`wait-what` 及 companion）；扩展 skill 目录（`incremental-implementation`、`impact-analysis`、`code-simplification`、`structured-refactoring`、`dsh-harness-contributor`、`explaining-changes`）；`brainstorming`、`using-superpowers`（反堆叠、tiny-edit、实现优先级、contextual gates）、`test-driven-development`、`systematic-debugging`（Stop-the-line、不可信错误输出、triage）、`requesting-code-review` 中的合并段落；`src/index.ts` 中的私有 invocation/`tier` 解析；`assets/NOTICE.md` 中的 Matt 段。

**CI 门禁（不只依赖 README）：** `tests/superpowers.spec.ts` 的 `skill composition contracts` 断言带 `metadata.tier` 的 skill 恰好是这九个 Matt 名称。`catalog description contracts` 断言语义 description 组（fail）、positive 段 negative boundary 防路由污染（fail），以及扩展 skill 间的 positive trigger 重叠（仅 warn）。obra 再移植时丢掉 Matt 目录或清掉 `tier` 会使该包测试失败。

## Model Experience

### System-prompt bootstrap

#### What the model sees

每个非 subagent 请求上，`system-prompt/assemble` 前置段 `skill:superpowers`，文本为 `buildBootstrapPreamble(...)`：Superpowers 的 `<EXTREMELY_IMPORTANT>` 包装、完整 `using-superpowers` SKILL.md，以及 `skills/using-superpowers/references/dsh-tools.md` 适配说明。无 agent 的组装与 `session.header.origin === 'subagent'` 省略该段。引导随系统提示每轮重装，不是一次性用户消息，因此不会被 compaction 丢掉。

#### Token effect

每个非 subagent 请求携带一段较长的系统提示段；skill 目录开销由 `dsh-tool-skill` 负责。

#### KV Cache effect

在固定 `skillsRoot` 与 `bootstrap` 开关下为稳定前缀：段文本在插件 apply 时加载一次并复用。`bootstrap` 保持开启且随包 preamble 不变时，渲染文本逐字节稳定，warm 前缀缓存可复用。更改 `skillsRoot` 或关闭 `bootstrap` 会改变组装结果。

### Skill catalog and `skill` tool

#### What the model sees

经 `@deepseek-ai/dsh-tool-skill` 间接呈现：目录中的 Superpowers skill 摘要，以及通过 `skill` 加载的正文。

#### Token effect

随 skill 数量与目录描述上限变化。打包目录共二十九个 skill，含六个纪律扩展 skill（`incremental-implementation`、`impact-analysis`、`code-simplification`、`structured-refactoring`、`dsh-harness-contributor`、`explaining-changes`）。

#### KV Cache effect

与 skill 消费方相同：初始目录接在可复用前缀后；替换目录追加。

## Known Limitations and Deferred Work

- **不是上游 hook 二进制** — 引导是 Cordis `system-prompt/assemble` 监听，不是 `hooks/session-start`。
- **`complete` persona 会替换所有 section** — 组合中注册了 `complete` persona（agent preset）的 agent，其所有 prompt section（含 `skill:superpowers`）都会被抑制。
- **随包 preamble 须避免 `{{...}}` 提示变量语法** — `loadBootstrapPreamble` 在插件 apply 时拒绝完整 `{{name}}` 组（对齐 skill-always-apply）；自定义 `skillsRoot` 若引入此类语法会在首轮前失败。
- **跨 harness 参考内容已移除** — 外平台工具对照、Anthropic 专属写作指南、以及特定 harness 的测试示例均省略；`dsh-tools.md` 是唯一平台适配，且必须写到足以支撑 SDD 的等待/续聊/模型路由。
- **上游同步为手工** — 无 vendored 子模块；移植即对照记录 commit diff 后重放 dsh 适配。本地 `superpowers/` 检出仅供对照，已 gitignore。
- **peer 来自 DeepSeek Harness** — 本组合包不内嵌 `@deepseek-ai/dsh-*`；请安装到已有 CLI/base 栈的 profile。
- **fork 产品 base 可能挂载发布 scope** — 部分 fork 的 `dsh-base` 组合依赖 `@firefly0621/dsh-superpowers`，使产品默认与 npm 身份保持同一包；本 monorepo 仅通过 overlay patch 或 `dsh plugin add` 挂载。拆分私有 workspace 名与发布名仍暂缓。
