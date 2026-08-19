# @firefly0621/dsh-skill-superpowers

[English](README.md) | 中文

可安装的 DeepSeek Harness 插件组合包：把 [obra/superpowers](https://github.com/obra/superpowers) 接入产品会话——完整 skill 库（已适配 dsh 工具）+ 等价于 SessionStart 的引导注入。

发布名：`@firefly0621/dsh-skill-superpowers`（版本跟随 harness 家族，当前为 `0.1.0-rc.9`）。本 fork 包的源码真源：[github.com/oThTJx/dsh-skill-superpowers](https://github.com/oThTJx/dsh-skill-superpowers)。本包为显式 opt-in，不属于官方 main 的 `dsh-base` 组合。

## 还原的能力

| Superpowers 行为 | dsh 实现 |
|---|---|
| `skills/*/SKILL.md` 技能库 | `ctx.skills` 提供方 `superpowers`（打包的 `skills/` 目录，已适配 dsh） |
| SessionStart 注入 `using-superpowers` | `agent/session-start` → `agent.inject()`，同一套 `<EXTREMELY_IMPORTANT>` 框架 |
| 平台 `references/*-tools.md` | 引导中附加 `skills/using-superpowers/references/dsh-tools.md` |
| 子代理跳过（`SUBAGENT-STOP`） | `session.header.origin === 'subagent'` 时不引导 |
| 按需加载其他 skill | 现有 `dsh-tool-skill` 目录 + `skill` 工具 |

skill 正文以 dsh 适配后的形式随包发布在 `skills/` 下（无 vendored 源码、无 git submodule）：外 harness 工具名与平台引用已改写为 dsh 等价物，`superpowers:` 前缀已移除。发布 tarball 包含 `skills/` 与 `assets/NOTICE.md`（记录上游出处 `obra/superpowers` @ `b36e0829` v6.3.0 与 MIT 许可）。

## 安装进 dsh profile

需要 DeepSeek Harness peer 为 `^0.1.0-rc.5`（`@deepseek-ai/dsh-skill` 等），通常来自官方 CLI / `dsh-base` 栈。

```sh
dsh plugin --profile web add @firefly0621/dsh-skill-superpowers
```

源码树中：

```sh
pnpm dsh plugin --profile web add @firefly0621/dsh-skill-superpowers
```

然后启动 `dsh --profile web`（或 `pnpm dsh web`）。若本 fork 的 `dsh-base` 已挂载 `id: skill-superpowers`，不要再重复安装——先禁用 base 行，或使用不含该行的 profile。

### 本地 / 发布前自检

```sh
pnpm run build:lib:host
pnpm --filter @firefly0621/dsh-skill-superpowers pack
pnpm dsh plugin --profile superpowers-demo add ./firefly0621-dsh-skill-superpowers-0.1.0-rc.7.tgz
```

（`pnpm pack` 默认把 tarball 写到仓库根目录。包本身没有 `build` script；由 host lib 构建产出 `lib/`。）

## 在本 monorepo 中启用（不经过 npm）

fork 的 `dsh-base` 组合默认挂载本插件。按常规启动即可：

```sh
pnpm dsh web
pnpm dsh --profile headless "task"
```

若要省略，在 `superpowers` 配置行上设置 `disabled: true`。包内仍保留 `cordis.patch.yml`：

```sh
dsh web --patch packages/skill/skill-superpowers/cordis.patch.yml
```

## 配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `skillsRoot` | 打包的 `skills/` 目录 | skill 根目录 |
| `bootstrap` | `true` | 会话开始注入引导 |

## 更新 Superpowers

不再保留 vendored 子模块。若要移植更新的上游版本：对照记录的上游 commit（`b36e0829`，v6.3.0）diff 上游 `skills/`，再手工重放 dsh 适配——替换外 harness 工具名与平台引用、移除 `superpowers:` 前缀，行为内容保持逐字。

## Model Experience

### Session-start bootstrap

#### What the model sees

非 subagent 会话在 `startup` 时注入一条 durable 的 plugin 用户消息：Superpowers 的 `<EXTREMELY_IMPORTANT>` 包装、完整 `using-superpowers` SKILL.md，以及 `skills/using-superpowers/references/dsh-tools.md` 适配说明。`resume` 仅在恢复日志中尚无 Superpowers 引导时补注（例如启用 overlay 之前创建的会话）。若 compaction 遮蔽了 durable 副本，下一次 pre-step 会补注，引导不会在会话中途丢失。

#### Token effect

每个需要引导的会话保留一段较长 preamble；skill 目录开销由 `dsh-tool-skill` 负责。

#### KV Cache effect

在该会话已有可复用前缀之后追加；已含引导的 resume 不再追加第二份；被 compaction 遮蔽后的补注追加一份新副本。

### Skill catalog and `skill` tool

#### What the model sees

经 `@deepseek-ai/dsh-tool-skill` 间接呈现：目录中的 Superpowers skill 摘要，以及通过 `skill` 加载的正文。

#### Token effect

随 skill 数量与目录描述上限变化。

#### KV Cache effect

与 skill 消费方相同：初始目录接在可复用前缀后；替换目录追加。

## Known Limitations and Deferred Work

- **不是 Claude Code hook 二进制** — 引导是 Cordis 监听，不是 `hooks/session-start`。
- **跨 harness 参考内容已移除** — Anthropic 的 Claude 专属 best-practices 指南、CLAUDE.md 测试示例、以及源自 Claude 的创建日志均删除而非随包分发；dsh 技能正文自洽。
- **上游同步为手工** — 无 vendored 子模块；移植即对照记录 commit diff 后重放 dsh 适配。
- **peer 来自 DeepSeek Harness** — 本组合包不内嵌 `@deepseek-ai/dsh-*`；请安装到已有 CLI/base 栈的 profile。
- **fork 默认挂载发布 scope** — `dsh-base` 依赖 `@firefly0621/dsh-skill-superpowers`，使产品默认与 npm 身份保持同一包；拆分私有 workspace 名与发布名仍暂缓。
