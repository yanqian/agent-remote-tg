# Agent Workflow

A spec-driven long-running agent workflow for recoverable AI-assisted development.

这是一套适合 long-running agent 的开发流程。核心目标是让项目在长时间、多轮次、可中断的 AI 协作中仍然保持可恢复、可验证、可继续推进。

它适合需求持续演进、需要明确验收标准、agent 可能中断或换会话的项目。对于一次性小脚本或很小的临时修改，这套流程会显得偏重。

## 核心原则

- 不依赖聊天历史，所有长期状态都写进仓库文件。
- `SPEC.md` 描述需求和验收标准。
- `feature_list.json` 描述可执行 feature、状态和完成情况。
- `progress.md` 描述当前系统状态、最近完成内容、下一步和已知问题。
- `test_plan.md` 描述 feature 的测试覆盖证据。
- `init.sh` 是完整验证入口，失败必须 `exit 1`。
- `orchestrator.py` 负责编码、评估和提交的自动化闭环。

## 项目初始化

在新项目根目录人工准备或复制这些基础文件：

- `AGENTS.md`
- `orchestrator.py`

注意：`AGENTS.md` 和 `orchestrator.py` 应放在项目根目录，不是放进 `docs/`。`orchestrator.py` 拼写要正确。

下面这些文件应该由 AI 在初始化阶段生成，而不是人工先写好：

- `SPEC.md`
- `feature_list.json`
- `progress.md`
- `test_plan.md`
- `init.sh`

初始化时可以让 AI 扮演 Initializer Agent。人的角色是提供需求背景和发起初始化指令，具体文件由 AI 按 `AGENTS.md` 生成：

```text
你现在是 initializer agent。

你的任务是初始化一个可运行项目环境。

请执行：

1. 根据需求生成 SPEC.md
2. 根据 SPEC.md 生成 feature_list.json
3. 所有 feature 初始 passes=false
4. 创建 progress.md
5. 创建 test_plan.md
6. 创建 init.sh（必须可运行）
7. 初始化 git repo 并 commit
8. 不要实现复杂业务逻辑

【init.sh 要求】
- 幂等
- 可在新环境运行
- 执行完整验证入口
- 至少包含 build，以及项目当前已有的 unit / harness / contract 或 smoke 检查
- 失败必须 exit 1
```

## Plan 阶段

先和 AI 反复讨论想法，直到需求足够清楚。中间产物可以是 PRD、草稿、设计说明或聊天总结，但最终必须落到仓库里的 `SPEC.md`。

可以使用这个 prompt：

```text
帮我把这个需求转成一个“适合 long-running agent 的 spec”。

要求：
- 明确 goal
- 明确 scope（include / exclude）
- 明确 core concepts
- 明确 core flows
- 明确 constraints
- 明确 acceptance criteria
- 明确 verification plan
- 不允许模糊描述
- 去掉 maybe / optional / minimal / 可以 / 后续考虑 等会让 agent 自由发挥的表达
```

Plan 阶段不是只写 `SPEC.md`。真正可执行的状态还需要同步到 `feature_list.json`：

- 每个可交付功能对应一个 feature ID，例如 `F043`。
- 新 feature 只能 append 到数组末尾。
- 不修改旧 feature ID。
- 不重排旧 feature。
- 不重置旧 feature 的 `passes`、`status`、`attempts`、`last_error`。
- 新 feature 默认 `passes=false`、`status=todo`、`attempts=0`。

推荐规划提交格式：

```bash
jq empty feature_list.json
git add SPEC.md feature_list.json
git commit -m "Plan F043 short feature name"
```

## 标准执行流程

每轮功能开发建议只处理一个 feature。

因为项目根目录已经有 `AGENTS.md`，下面的流程主要由 AI 按角色规则执行。人的角色是提出目标、确认方向、必要时中断或调整；不要把每一步都当成人工手动操作。

AI 执行的标准流程：

```text
1. 读取 progress.md、feature_list.json、git log --oneline -20
2. 如果是新需求，先 append SPEC.md 和 feature_list.json
3. 提交 planning commit
4. 运行 python3 orchestrator.py --max-rounds 1
5. Coding Agent 实现当前 feature
6. Evaluator Agent 独立验证当前 feature
7. 只有 Evaluator 输出 EVAL_PASS: Fxxx 后，orchestrator 才能标记 done 并提交
8. 推送远程
9. 检查 CI
```

人通常只需要发起类似这样的指令：

```text
新增这个需求。先更新 SPEC.md 和 feature_list.json，然后使用 orchestrator 实现并验证。
```

运行命令：

```bash
python3 orchestrator.py --max-rounds 1
```

如果需要连续跑多个 feature：

```bash
python3 orchestrator.py --max-rounds 5
```

不要让 Coding Agent 自己提交。正常情况下，最终实现提交由 orchestrator 完成。

## 编码阶段

告诉 AI 使用 orchestrator 执行指定数量的 feature。orchestrator 会串行做两件事：

- 启动 Coding Agent，实现一个 feature，并更新状态文件。
- 启动 Evaluator Agent，验证这个 feature 是否真的满足 SPEC 和测试要求。

Evaluator 必须输出：

```text
EVAL_PASS: Fxxx
```

或者：

```text
EVAL_FAIL: Fxxx: <reason>
```

只有 `EVAL_PASS` 后，feature 才能变成：

```json
{
  "passes": true,
  "status": "done"
}
```

## 新需求或 Bug Fix

新需求和 bug fix 都走轻量版 Plan + 编码流程：

```text
1. 描述新需求或 bug
2. 让 AI 先更新 SPEC.md
3. 让 AI append 一个新的 feature 到 feature_list.json
4. 提交 planning commit
5. 使用 orchestrator 实现
6. 等 evaluator pass
7. 推送并检查 CI
```

不要直接修改旧 feature 的状态来代表新需求。即使是很小的 ReviewBot 反馈，也建议 append 一个新 feature，这样历史和完成依据清楚。

## 测试分层

不要把所有测试都继续堆进一个 `smoke-test.mjs`。推荐分三层：

### Unit

命令：

```bash
npm run test:unit
```

用于测试纯逻辑，例如：

- tag normalize / match
- date normalize
- excerpt 生成
- Markdown preview
- content hash
- settings normalize
- display history normalize
- startup cooldown
- AI payload 隐私约束中可纯函数化的部分

如果纯逻辑还在 `main.ts` 里，可以导出 helper，或者逐步拆到 `src/core.ts`。

### Harness

命令：

```bash
npm run test:harness
```

用于测试插件行为。可以继续使用 mock Obsidian 的方式验证：

- command 注册
- ribbon icon
- settings UI
- modal 按钮
- memory selection
- AI provider 调用
- cache 行为
- ReviewBot 静态规则

`npm run smoke` 可以保留为兼容 alias，指向 harness。

### Contract

命令：

```bash
npm run test:contract
```

用于验证规格和覆盖没有遗漏：

- `docs/manual-verification.md` 是否覆盖 SPEC 中的人工验证场景
- `test_plan.md` 是否为每个 `passes=true` feature 提供覆盖证据
- `feature_list.json` 是否没有重复 ID

完整验证入口：

```bash
./init.sh
```

建议 `init.sh` 至少包含：

```bash
npm run build
npm run test:unit
npm run test:harness
npm run test:contract
```

## test_plan.md 规则

`test_plan.md` 是 feature 完成依据的索引，不只是人工测试文档。

一个 feature 只有在满足下面条件后，才应该被标记为 `passes=true`：

1. Code compiles。
2. 相关 unit / harness / contract 测试通过。
3. 如果无法完全自动化，human-style flow 已写入 manual verification。
4. 现有 smoke / harness 没有回归。
5. `test_plan.md` 里有该 feature 的覆盖行。

覆盖行示例：

```md
| F043 | Unit + harness + contract | `npm run test:unit`, `npm run test:harness`, and `npm run test:contract` verify explicit test layers. |
```

## 状态安全规则

在任何时候都要遵守：

- 不覆盖整个 `feature_list.json`。
- 不删除未知字段。
- 不重排 feature。
- 不把 unrelated feature 标记为 done。
- 不 revert 用户已有改动。
- 工作区有陌生变更时，先识别并避开。
- 如果遇到无法判断的冲突，先停下来说明。

## 推送和发布

普通开发完成后：

```bash
git push
```

如果改动影响运行时代码或发布资产，还需要同步：

```bash
cp manifest.json main.js styles.css "<vault>/.obsidian/plugins/<plugin-id>/"
gh release upload <version> manifest.json main.js styles.css --clobber
```

然后检查 CI：

```bash
gh run list --limit 5
gh run watch <run_id>
```

如果项目涉及第三方审核 PR，可以通过空提交触发审核检查，但要确保 PR 内容本身已经正确。
