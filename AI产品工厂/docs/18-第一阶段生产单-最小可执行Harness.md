# 第一阶段生产单｜最小可执行 Harness

> 迁移状态（2026-09-02）：本生产单保留为 Pi Agent + DeepSeek 时期历史证据，不再作为当前 Codex App Server 生产单。
>
> 生产单状态：G6 `approved`（产品负责人于 2026-08-25 确认）
>
> 生产单 ID：`PO-V02B-HARNESS-001`
>
> 版本：`1.0.0`
>
> 配套开发文档：`docs/17-第一阶段技术开发文档-最小可执行Harness.md`
>
> 配套完成目标：`docs/19-第一阶段完成目标-最小可执行Harness.md`
>
> 本生产单是 G6 通过后交给开发执行 Agent 的受控输入；确认前不得据此修改生产代码。

## 1. objective

在保留现有功能、数据和三份手册完整性的前提下，实现 V0.2-B 最小可执行 Factory Harness，使单个 Pi Agent + DeepSeek 能在独立测试工作区内通过受控工具完成：

```text
读取 → 修改 → 测试失败 → 读取失败 → 修复 → 复测通过 → 登记产物和证据
```

阶段成功必须由确定性完成验证和真实证据证明，不能由模型停止或文字自评决定。

## 2. inputs

### 2.1 最高权威输入

按以下固定顺序校验并完整读取，不得使用摘要替代：

1. `../AI产品Vibe Coding通用技术栈手册.md`；
2. `../AI产品Vibe Coding通用前端技术栈手册.md`；
3. `../AI Agent 产品上线部署手册.md`。

三份手册必须先通过 `npm run manuals:verify`。任一缺失或哈希不符，生产单立即 blocked。

### 2.2 已确认上游输入

1. `docs/12-AI产品工厂-产品需求文档-PRD.md`；
2. `docs/13-AI产品工厂-技术适配声明.md`；
3. `docs/14-AI产品工厂-Harness五要素领域骨架.md`；
4. `docs/15-AI产品工厂-Agent-Blueprint组件选型表.md`；
5. `docs/16-AI产品工厂-七层架构与产品生产蓝图.md`；
6. `docs/17-第一阶段技术开发文档-最小可执行Harness.md`；
7. `docs/19-第一阶段完成目标-最小可执行Harness.md`。

### 2.3 现有工程事实

- 当前分支及其未提交修改；
- `package.json`、lockfile、workspace 包和版本；
- 当前 SQLite 数据库和记录数；
- 现有 `AgentRuntime`、`PiAgentRuntime`、`InMemoryAgentRuntime`；
- 现有 Worker、ProductionController、RunStore、SSE 和 WebUI；
- Pi Agent 0.84.2 的真实类型和公开接口；
- `.env.example` 的非秘密配置说明；
- `tests/fixtures/harness-loop/` 只读 fixture。

执行前必须读取 Git 状态、测试状态和数据库状态；不得先重构再理解。

## 3. constraints

### 3.1 必须保持

- 现有用户功能和数据可继续使用；
- 现有 `AgentRuntime` 调用方获得兼容迁移，不把 Pi 供应商类型泄露到 Web；
- 三份手册原文件内容、文件名和 SHA256 不变；
- `.env`、`data/factory.sqlite` 和根目录 `agent-blueprint/` 不进入 Git；
- 同一工作区只有一个写入执行；
- Worker 与 Web 请求分离，页面断开不终止后台任务；
- 只有 Worker 读取 DeepSeek Key；
- 任何工具请求和结果用唯一 `toolCallId` 配对；
- 所有阶段终态由确定性代码写入。

### 3.2 范围限制

- 只实现 `docs/17` 的 V0.2-B；
- 不实现完整 WorkflowRuntime、完整 GoalGate、G7、G8、G9；
- 不生产小游戏或其他正式产品；
- 不增加 Subagent、Memory、Teams、Cron、MCP、RAG、多用户或外部服务；
- 不进行 Git commit、push、远程建仓或部署；
- 不安装未在 `docs/17` 明确说明的辅助库；
- 不删除、重建或手工改写现有 SQLite 数据；
- 不使用 raw shell string、`shell:true` 或工作区外路径；
- 不读取或回显 `.env`；
- 不把 mock 冒充真实模型或真实浏览器验收。

### 3.3 实现顺序

1. 确认本产品流程已锁定三份手册快照，并校验环境、Git 和数据；
2. 建立 failing tests，冻结接口和安全边界；
3. 实现编号迁移与 records；
4. 实现 ToolGateway、权限、ManualAuthority 和工具；
5. 实现 Task、BackgroundRunner、WorkPlan、Artifact、Evidence；
6. 接入 Pi Agent Adapter 与 FactoryHarness；高层 AgentHarness 未实现壳不得作为生产入口；
7. 接入 Worker 和最小 WebUI；
8. 跑 mock 自动化闭环并修复；
9. 跑真实 DeepSeek 冒烟；
10. 跑真实浏览器验收；
11. 运行全部自动检查、复核数据与已锁定手册快照记录；
12. 输出阶段报告并停在 G7 前。

## 4. allowedTools

### 4.1 开发执行 Agent 可使用

| 工具类别 | 允许范围 | 权限 |
| --- | --- | --- |
| 文件读取与搜索 | `AI产品工厂/`、本产品流程已锁定的三份手册快照、Pi 依赖公开类型 | P0 |
| 文件修改 | `AI产品工厂/` 中与本生产单直接相关的源码、测试、文档和配置 | P1 |
| Git 检查 | status、diff、log、show、rev-parse | P0 |
| 依赖检查 | `npm ls`、读取 package manifest/lockfile | P0 |
| 自动检查 | manuals verify、lint、typecheck、Vitest、Next build | P1 |
| 本地服务 | 启动/停止本项目 Web 与 Worker | P1 |
| 浏览器 | 本地项目页面的真实验收、Console、Network、截图 | P1 |
| DeepSeek | 使用已配置 Key 运行本生产单规定的一次最小真实冒烟 | P1，受费用上限约束 |

### 4.2 FactoryHarness 运行时注册工具

```text
manual.verify
manual.load
workspace.list
workspace.read
workspace.search
workspace.patch
git.inspect
command.run
test.run
workplan.update
task.manage
background.manage
artifact.register
evidence.register
```

未列出的工具不注册。Git commit/push、删除、发布和外部系统写入不提供可执行实现。

## 5. modelProfile

```yaml
provider: deepseek
model: deepseek-v4-flash
runtime: "@earendil-works/pi-agent-core Agent 0.84.2"
catalog: "@earendil-works/pi-ai 0.84.2"
thinkingLevel: low
toolExecution: sequential
drive: "Agent.prompt + sequential tool loop"
requestTimeoutMs: 90000
maxRetries: 2
temperature: provider_default
apiKeySource: DEEPSEEK_API_KEY
```

启动时必须通过 Pi 模型目录确认模型存在。模型不存在、Key 缺失、认证失败、超时或限流时如实 blocked/failed，不静默切换其他模型。

## 6. budgets

预算同时受生产单值和系统硬上限约束，取两者较小值。

```yaml
tokenBudget:
  maxInputTokens: 300000
  maxOutputTokens: 60000
  maxContextWindowTokens: 900000
costBudget:
  currency: USD
  maxEstimatedCost: 0.50
  pricingSource: "Pi model catalog at run start"
timeBudget:
  maxWallTimeMs: 7200000
  maxModelRequestMs: 90000
  maxForegroundCommandMs: 180000
  maxBackgroundCommandMs: 600000
stepBudget:
  maxAgentTurns: 24
  maxToolCalls: 80
  maxPatchCalls: 12
  maxTestRuns: 12
  maxConsecutiveToolFailures: 4
retryBudget:
  modelRetriesPerRequest: 2
  taskAttempts: 2
```

达到任一上限时停止新增行动，登记 `budget_exhausted`、已完成事实、缺失标准和安全下一步。不得通过重置计数或新建相同 Task 绕过预算。

## 7. acceptanceCriteria

### AC-01 手册权威

- 三份手册校验全部通过后才调用模型；
- 任一缺失或哈希错误时零模型调用、零工作区写入；
- 同一产品流程的工位、返工、重试和恢复复用首次锁定的快照，不重新读取磁盘原文；
- 流程完成或终止后释放快照且禁止重读；下一个新产品流程重新校验并完整读取；
- 日志、数据库、Session 和截图不包含三份原文副本。

### AC-02 单一 Agent Loop

- FactoryHarness 使用 Pi `Agent` 作为唯一工具循环；
- 高层 `AgentHarness` 的未实现 `prompt` / Hooks 不得被当成已交付能力；
- 未实现第二套自定义 while-loop；
- run、steer、abort 和 terminal outcome 均有统一 Adapter 与测试。

### AC-03 ToolGateway 与权限

- P0/P1/P2/P3 均有自动测试；
- 路径逃逸、symlink、`.env` 读取和 raw shell 均被阻止；
- P2 返回 approval_required 且没有副作用；
- 同一 toolCallId 不重复副作用。

### AC-04 持久任务与后台执行

- Task 原子领取并持久化；
- 长测试可启动、查询、取消；
- Worker 中断后孤儿 job 标为 interrupted，输出仍可查看；
- 本阶段不伪装成完整 checkpoint 自动恢复。

### AC-05 数据安全迁移

- 编号迁移在事务中执行；
- 迁移前备份存在；
- 空库、现有库副本、重复迁移均通过；
- 原有项目、运行和事件数据不减少、不变化。

### AC-06 确定性失败—修复闭环

- mock 集成测试真实保存第一次 test failure；
- Agent 在失败 ToolResult 后继续读取、修改和复测；
- 最终 test passed；
- Git diff、测试报告、Artifact、Evidence 全部登记；
- 每个工具调用有唯一 terminal result。

### AC-07 完成判定

- `agent_end` 单独出现时不能 succeeded；
- 空结果、失败工具、缺失 Artifact/Evidence 时不能成功或显示确认；
- 只有 CompletionVerifier 满足 `docs/19` 才 succeeded。

### AC-08 真实 DeepSeek

- 用真实 Key 跑通一条真实模型—工具—文件—测试—持久化链路；
- 记录模型、Prompt 版本、耗时、Token、重试、估算费用和结果；
- Key 不出现在任何交付 Artifact；
- 未执行时必须写“待验”，不得声称通过。

### AC-09 最小 WebUI

- 页面显示真实状态、目标、WorkPlan、最近 20 条事件、首次失败、最终测试、Artifact 和 Evidence；
- 固定高度事件区上下滚动；
- abort 真正取消后台执行；
- 刷新恢复真实记录；
- 390px、1280px、1440px 通过浏览器检查；
- Console 无错误，Network 无重复创建 Task。

### AC-10 工程检查

- `npm run manuals:verify` 通过；
- `npm run lint` 通过；
- `npm run typecheck` 通过；
- `npm run test` 全部通过；
- `npm run build` 通过。

## 8. completionGoal

完成目标的唯一权威是 `docs/19-第一阶段完成目标-最小可执行Harness.md`。

简化表达：

```text
complete =
  所有 AC-01..AC-10 有可追溯证据
  AND mock 失败—修复—复测闭环成立
  AND 真实 DeepSeek 冒烟成立
  AND 浏览器真实验收成立
  AND 数据与手册未受损
  AND 没有未解释的阻断检查
```

模型停止、生成一段报告、运行耗时足够长、页面动画结束或用户未回复都不满足 completionGoal。

## 9. expectedArtifacts

| Artifact ID | 必需产物 | 最低内容 |
| --- | --- | --- |
| ART-01 | 变更清单 | 修改/新增文件与职责，不含秘密 |
| ART-02 | 数据迁移报告 | 备份位置、版本、checksum、迁移前后记录核对 |
| ART-03 | mock 闭环报告 | 工具序列、首次失败、修复、最终通过、配对检查 |
| ART-04 | 独立工作区 diff | 只含 fixture 工作区真实变更 |
| ART-05 | 自动检查报告 | manuals、lint、typecheck、test、build 逐项结果 |
| ART-06 | DeepSeek 冒烟报告 | 模型、Prompt、耗时、Token、费用、终态、脱敏检查 |
| ART-07 | 浏览器验收报告 | 尺寸、Console、Network、状态、刷新、abort、截图 |
| ART-08 | 权限与安全报告 | P0–P3、逃逸、symlink、raw shell、`.env`、P2 零副作用 |
| ART-09 | 已知问题与交接 | 未完成、限制、V0.2-C 交接和回退方式 |

所有产物登记 SHA256、相对路径、来源 Task、生成时间和状态。大日志写文件，数据库只保存索引和脱敏摘要。

## 10. humanGatePolicy

### 10.1 G6 前

- 本生产单、`docs/17` 和 `docs/19` 必须由产品负责人明确确认；
- 未确认时只允许文档修改和只读检查，不允许生产代码、依赖、数据库 schema 或工作区写入。

### 10.2 G6 通过后的普通执行

- P0/P1 自动执行并记录，不逐次打扰产品负责人；
- 测试失败后 Agent 应在预算内自动修复，不因普通失败弹确认；
- 产品负责人通过 WebUI 查看状态、计划和证据，可 steer 或 abort。

### 10.3 重大动作

以下均为 P2：删除或覆盖用户数据、安装未在已确认技术方案中列出的新依赖、Git commit/push、远程建仓、外部发送、付费服务、模型超预算、发布和部署。本文已明确采用的 `typebox@1.3.7` 属于 G6 确认后的 P1 依赖变更，仍需锁文件和测试证据。

本阶段处理：

1. ToolGateway 返回 `approval_required`；
2. 记录动作、影响、费用、可恢复性和未执行证据；
3. 停止当前 Harness 为 `waiting_user`；
4. 不提供绕过方式，不自动执行；
5. 若该动作确实成为完成条件，先修改并重新确认 G6 生产单。

### 10.4 永久拒绝

读取或输出密钥、读取 `.env`、破坏三份手册、工作区逃逸、禁用测试或伪造证据属于 P3。普通产品负责人确认不能把 P3 变成允许。

### 10.5 阶段结束

- 自动检查通过后仍需产品负责人按 `docs/17` 验收清单真实操作；
- 产品负责人只确认“本阶段结果是否接受”，不自动触发小游戏、Git push 或部署；
- 阶段通过后停在 V0.2-C 文档准备前，等待下一次明确指令。

## 11. failurePolicy

| 退出 | 触发 | 必须保留 | 用户下一步 |
| --- | --- | --- | --- |
| `failed` | 工具、模型、测试或实现错误且预算内无法修复 | 失败结果、diff、日志、Task | 查看失败原因并安全重试 |
| `blocked` | 手册、Key、环境、权限或必要输入缺失 | 阻塞证据、未执行说明 | 补齐具体条件 |
| `waiting_user` | P2 或重大范围决定 | 请求、影响、零副作用证据 | 修改/确认生产单 |
| `cancelled` | 用户 abort | 已完成产物、取消时间、子进程结果 | 重新开始新 Task |
| `interrupted` | Worker 或进程异常中断 | Session、Task、最后工具结果、输出 | 创建安全重试 |
| `budget_exhausted` | 任一预算到达 | 用量、已完成项、缺失标准 | 调整并重新确认预算 |

失败不能被转换为空结果或 waiting_approval；没有满足完成目标时不创建“确认结果”按钮。

## 12. G6 确认

- [x] objective 正确；
- [x] inputs 的权威顺序正确；
- [x] constraints 没有漏掉用户数据、手册和危险动作保护；
- [x] allowedTools 只覆盖当前阶段；
- [x] modelProfile 继续使用 Pi Agent + DeepSeek；
- [x] token、费用、时间、步骤和重试预算可以接受；
- [x] acceptanceCriteria 和 expectedArtifacts 足以证明真实完成；
- [x] humanGatePolicy 符合“普通操作自动、重大动作确认”；
- [x] 失败、阻塞、中断和预算耗尽不会被伪装成成功。

产品负责人确认后，本生产单进入 `approved`；确认前保持 `draft`。
