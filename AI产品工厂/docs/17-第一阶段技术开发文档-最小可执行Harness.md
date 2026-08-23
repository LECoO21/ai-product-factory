# 第一阶段技术开发文档｜最小可执行 Harness

> 文档状态：G6 待产品负责人确认
>
> 所属路线：V0.2-B 最小可执行 Harness
>
> 已确认输入：`docs/12-AI产品工厂-产品需求文档-PRD.md`、`docs/13-AI产品工厂-技术适配声明.md`、`docs/14-AI产品工厂-Harness五要素领域骨架.md`、`docs/15-AI产品工厂-Agent-Blueprint组件选型表.md`、`docs/16-AI产品工厂-七层架构与产品生产蓝图.md`
>
> 配套产物：`docs/18-第一阶段生产单-最小可执行Harness.md`、`docs/19-第一阶段完成目标-最小可执行Harness.md`
>
> 规范依据：三份原始手册全文。三份原文继续保留在内部路径，不复制到公开仓库，不以本文替代。
>
> 执行边界：本文确认前只允许修改项目文档；确认后只实现本文阶段，不提前进入 V0.2-C、小游戏试产或公开部署。

## 一、阶段目标

### 1.1 一句话目标

把当前“一张生产单只调用一次模型”的 Worker，升级为一个可以在独立测试工作区内连续观察、调用受控工具、看到失败、修复并用真实证据结束的单 Factory Harness。

### 1.2 本阶段交付范围

- 单一 `FactoryHarness`，以 Pi Agent 的 `AgentHarness` 作为唯一 Agent Loop 底座；
- `ToolGateway`、`PreToolUse` / `PostToolUse` Hooks 与 P0–P3 权限裁决；
- `ManualAuthority`：先校验三份手册哈希，再按固定顺序完整加载当前阶段需要的原文；
- 工作区 `list / read / search / patch`；
- Git 只读检查；
- 无 Shell 拼接的受控命令与测试执行；
- 用户可见 `WorkPlan`；
- 每个工具调用与唯一结果严格配对；
- `Artifact`、`Evidence` 登记；
- 最小持久 `TaskSystem` 与 `BackgroundRunner`；
- `run / steer / abort` 的运行控制；
- 一个最小 WebUI 纵向切片，能看真实状态、计划、工具结果和证据；
- 独立测试工作区闭环：`读取 → 修改 → 测试失败 → 修复 → 复测通过`。

### 1.3 阶段产物

1. 可被 Worker 调用的 Factory Harness Module；
2. 受控工具、权限、Hooks、任务、后台执行和档案 Module；
3. SQLite 编号迁移与不删除现有数据的迁移证据；
4. 版本化 Prompt 与生产单；
5. mock 自动化测试报告；
6. 一次真实 DeepSeek 冒烟报告；
7. WebUI 浏览器验收截图和检查记录；
8. 独立测试工作区的 Git diff、首次失败和最终通过证据。

### 1.4 本阶段明确不做

- 不实现完整 `WorkflowRuntime`、Task DAG、journal、checkpoint 自动恢复；
- 不实现完整 `GoalGate`、QG-01–QG-06 全套裁决；
- 不让多个 Agent、Subagent 或 Agent Teams 并行工作；
- 不启用跨项目 Memory、Cron、MCP、RAG 或多租户；
- 不生产小游戏或任何正式目标产品；
- 不做正式视觉系统扩展，只做当前闭环必需的最小界面；
- 不执行 Git commit、Git push、远程建仓、外部发送或发布；
- 不创建云资源，不进入 veFaaS 部署；
- 不删除、覆盖或重建现有 `data/factory.sqlite`；
- 不把三份手册原文、`.env`、密钥或完整敏感输入写入日志和 Git。

### 1.5 本阶段主链路

```text
用户从本地 WebUI 启动“Harness 验证”
→ ProductionController 创建 implementation 生产批次与持久 Task
→ Worker 领取 Task，ManualAuthority 校验并加载三份手册
→ FactoryHarness 打开本次 Pi Agent Session，加载生产单与完成目标
→ Agent 建立 WorkPlan
→ 通过 ToolGateway 读取独立测试工作区
→ 首次修改并运行测试
→ 真实记录测试失败
→ Agent 读取失败结果并再次修改
→ 复测通过
→ 登记 diff、测试报告、Artifact 与 Evidence
→ CompletionVerifier 检查完成目标与证据
→ 只有证据完整才把运行标记 succeeded
→ WebUI 展示成功结果；否则显示 failed / blocked / cancelled / interrupted
```

模型停止、`agent_end`、页面等待超时或 SSE 断开均不等于成功。

## 二、技术适配摘要

### 2.1 延续已确认结论

- 产品形态：本地优先、单用户、对话式 Web AI 产品工厂；
- 架构：模块化单体，Next.js Web + Node Worker 双进程；
- 开发路径：纵向切片，因为 Agent 状态、工具轨迹、终止和恢复必须通过真实界面判断；
- Agent：Pi Agent；模型：DeepSeek；
- 数据：SQLite 保存生产事实，本地受控目录保存大文本、报告、Session 与工作区；
- 第一版：单 Worker、单写入者、单 Factory Agent；
- 普通 P0/P1 操作自动执行，P2 需要人工决定，P3 永久拒绝。

### 2.2 本阶段采用

- 继续使用现有 Node.js 22、TypeScript、Next.js 16、React 19、Zod、Vitest、SQLite；
- 使用已安装的 `@earendil-works/pi-agent-core@0.84.2` 与 `@earendil-works/pi-ai@0.84.2`；
- 直接使用 Pi 的高层 `AgentHarness`，项目只增加领域 Wrapper，不复制其 Agent Loop；
- Pi 工具参数使用 TypeBox schema，项目 API、配置、数据库和完成目标继续使用 Zod；
- Pi `AgentHarness` 生产 Session 使用 JSONL 本地持久化，测试使用内存 Session；
- 工具执行固定为 `sequential`，避免同一工作区并发写入；
- 长命令采用“提交 + 查询状态”，Web 状态与事件仍由 SQLite + SSE 提供。

### 2.3 本阶段启用的按需模块

| 模块 | 触发原因 | 本阶段处理 |
| --- | --- | --- |
| Pi `AgentHarness` | 产品需要连续工具行动、Hooks、steer、abort 与 Session | 启用 |
| TypeBox 1.3.7 | Pi 工具 schema 的直接契约 | 在 `@factory/agent-runtime` 声明直接依赖，锁定现有版本 |
| SQLite 新表 | Task、工具配对、计划、产物和证据需要持久事实 | 通过编号迁移增量创建 |
| JSONL Session | Agent 对话与工具结果需要可追溯，不能只在进程数组 | 写入受控 `data/harness-sessions/`，SQLite 只保存索引 |
| BackgroundRunner | 测试等慢任务不能绑定一次 Web 请求 | 提供最小启动、查询、取消和中断标记 |

### 2.4 偏离与暂缓

| 手册或蓝图默认 | 当前处理 | 原因与影响 | 重新评估条件 |
| --- | --- | --- | --- |
| Python + FastAPI | 延续 Node/TypeScript 模块化单体 | 已确认现有项目与 Pi Agent 依赖；避免双后端 | 现有栈无法满足 PRD时 |
| 生产级完整恢复 | 本阶段保存 Session、Task 和证据；Worker 重启后把活动执行标为 `interrupted`，允许安全重试 | V0.2-C 才实现 Workflow checkpoint 自动恢复；本阶段不丢事实，但不承诺从任意工具调用点自动续跑 | 进入 V0.2-C |
| 完整 Goal Gate | 使用最小 `CompletionVerifier` 只核对本阶段完成目标 | 先证明工具闭环，不提前实现全厂质量系统 | 进入 V0.2-C |
| P2 批准后原地恢复 | 本阶段 P2 返回 `approval_required` 并停止当前 Harness，绝不执行；批准与原地恢复放 V0.2-C | 本阶段没有真实 P2 业务动作，先验证安全边界 | 首个正式产品需要 P2 时 |
| 正式前端阶段 | 只增加最小运行控制切片 | 当前界面用于判断 Harness 是否真实工作 | G7 后进入正式终端阶段 |

## 三、技术栈与 Pi Agent 接口结论

### 3.1 实际组件

| 能力 | 组件 | 版本或策略 |
| --- | --- | --- |
| Web | Next.js / React / TypeScript | 延续锁文件版本 |
| Worker | Node.js / tsx | Node.js 22；单写入 Worker |
| Agent Loop | Pi `AgentHarness` | `@earendil-works/pi-agent-core@0.84.2` |
| 模型目录和流 | Pi AI `Models` + DeepSeek provider | `@earendil-works/pi-ai@0.84.2` |
| 工具 schema | TypeBox | 1.3.7，作为直接依赖声明 |
| 应用 schema | Zod | 4.4.3 |
| 生产事实 | better-sqlite3 | 13.0.3，WAL、外键、事务、编号迁移 |
| Session | Pi `JsonlSessionRepo` | 本地受控目录；测试用 `InMemorySessionRepo` |
| 测试 | Vitest | 4.1.11 |
| 浏览器 | 真实浏览器检查 | G6 代码完成后执行，不用 mock 页面代替 |

### 3.2 已核对的真实 Pi 接口

- `AgentHarness.create(options)` 需要真实 `Session`、`Models` 和 `Model`；
- `AgentLane.prompt()` 返回 `RunResult`，可能为 `completed / aborted / failed / suspended`；
- `steer()` 在当前 Assistant turn 的工具执行结束后注入消息，不跳过已发起工具；
- `abort()` 中止当前活动操作，并返回尚未消费的 steer / follow-up；
- `runToCompletion()`、`waitForIdle()` 和 `watch()` 可驱动和观察运行；
- Harness Hooks 包含 `before_tool`、`after_tool`；底层 Agent 也提供 `beforeToolCall`、`afterToolCall`；
- `AgentTool.execute` 在失败时应抛出，Pi 会生成错误 ToolResult；项目的 ToolGateway 负责把预期权限与业务失败先归一化；
- 工具调用通过 `toolCallId` 配对，事件包含 `tool_execution_start / update / end`；
- `AgentHarness` 支持 `drive: automatic | manual`，本阶段生产使用 automatic，测试可用 manual 精确验证动作；
- `AgentHarness` 支持 durable Session，但本阶段不会把它等同于完整 Workflow checkpoint。

### 3.3 FactoryHarness Interface

```ts
type FactoryHarnessCommand =
  | { kind: "run"; taskId: string }
  | { kind: "steer"; harnessRunId: string; message: string }
  | { kind: "abort"; harnessRunId: string; reason: string };

interface FactoryHarness {
  run(taskId: string): Promise<HarnessRunSnapshot>;
  steer(harnessRunId: string, message: string): Promise<CommandReceipt>;
  abort(harnessRunId: string, reason: string): Promise<CommandReceipt>;
  get(harnessRunId: string): HarnessRunSnapshot | null;
}
```

调用方只知道任务、控制命令和统一快照，不知道 DeepSeek payload、Pi Session mutation、工具实现或 SQL。

## 四、环境与配置

### 4.1 环境要求

- Node.js `>=22`；
- npm 与仓库锁文件；
- Git；
- `rg` 可用时用于搜索，缺失时回退到受控文件遍历；
- 本地可启动 Next.js Web 与 Worker；
- 真实冒烟前存在有效 `DEEPSEEK_API_KEY`，无 Key 只允许完成 mock 测试，不得标记 G6 验收通过。

### 4.2 配置项

| 配置 | 秘密 | 默认值 | 规则 |
| --- | --- | --- | --- |
| `DEEPSEEK_API_KEY` | 是 | 无 | 只由 Worker 读取；不回显、不入日志和 Git |
| `DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | 启动时必须在 Pi 模型目录中真实存在，否则 blocked |
| `FACTORY_DATA_DIR` | 否 | `<repo>/data` | 数据库、Session、报告根目录 |
| `FACTORY_WORKSPACE_ROOT` | 否 | `<FACTORY_DATA_DIR>/workspaces` | 所有目标工作区必须位于其内 |
| `HARNESS_MAX_TURNS` | 否 | `24` | 系统硬上限；生产单可以更低，不能更高 |
| `HARNESS_MAX_TOOL_CALLS` | 否 | `80` | 系统硬上限 |
| `HARNESS_MAX_WALL_MS` | 否 | `7200000` | 单阶段生产最多 120 分钟 |
| `HARNESS_MODEL_TIMEOUT_MS` | 否 | `90000` | 单次模型请求超时 |
| `HARNESS_MODEL_MAX_RETRIES` | 否 | `2` | 模型有限重试，不包含首次请求 |
| `HARNESS_COMMAND_TIMEOUT_MS` | 否 | `180000` | 单个受控命令默认最多 3 分钟 |

所有数值配置在启动时用 Zod 校验；非法值使 Worker blocked，不静默回退。`.env.example` 只写空值或非秘密示例。

### 4.3 运行端口

- Web：延续 Next.js 默认 `3000`，端口冲突时使用不破坏其他项目的替代端口并报告；
- Worker：无公网监听端口；
- 进程通信：SQLite 任务和事件；
- SSE：沿用 `/api/runs/:id/events`，断线按 `after` 序号续读。

## 五、项目结构

本阶段确认后按现有 monorepo 做最小增量，不创建平行后端：

```text
packages/
├── agent-runtime/src/
│   ├── index.ts                    # AgentRuntime 兼容出口
│   ├── factory-harness.ts          # 包装 Pi AgentHarness
│   ├── pi-harness-adapter.ts       # Models、Session、事件映射、steer、abort
│   └── prompts/
│       └── factory-harness-v1.ts   # 版本化系统 Prompt
├── harness/src/
│   ├── index.ts                    # 深 Module 公共 Interface
│   ├── manual-authority.ts
│   ├── tool-gateway.ts
│   ├── permission-policy.ts
│   ├── work-plan.ts
│   ├── task-system.ts
│   ├── background-runner.ts
│   ├── completion-verifier.ts
│   ├── tools/
│   │   ├── workspace.ts
│   │   ├── git-inspect.ts
│   │   ├── command.ts
│   │   ├── test.ts
│   │   └── records.ts
│   └── adapters/
│       ├── local-execution-env.ts
│       └── test-execution-env.ts
├── records/src/
│   ├── index.ts                    # 保留兼容出口
│   ├── migrations.ts               # 编号迁移执行器
│   └── migrations/
│       ├── 0001-existing-baseline.ts
│       └── 0002-minimum-harness.ts
└── shared/src/
    ├── index.ts                    # 保留兼容出口
    └── harness-schemas.ts

apps/
├── worker/src/
│   ├── index.ts
│   └── execute-harness-task.ts
└── web/
    ├── app/api/runs/[id]/abort/route.ts
    ├── app/api/runs/[id]/steer/route.ts
    └── components/harness-run-panel.tsx

tests/fixtures/harness-loop/             # 只读种子，不在原地修改
data/                                    # Git 忽略
├── factory.sqlite
├── backups/
├── harness-sessions/
├── reports/
└── workspaces/<runId>/                  # 每次测试复制出的独立 Git 工作区
```

具体文件可因实现收敛合并，但 Module 边界、依赖方向和验收能力不得缺失。

## 六、数据、资产与状态

### 6.1 迁移策略

1. 新建 `schema_migrations(version, name, checksum, applied_at)`；
2. `0001-existing-baseline` 以幂等方式登记当前已有表，不重建、不复制用户数据；
3. `0002-minimum-harness` 只新增表、列和索引；
4. 首次迁移前创建一致性备份到 `data/backups/`；
5. 每个迁移在事务中执行，checksum 不一致立即 blocked；
6. 迁移失败保留原数据库和备份，禁止自动删除重试；
7. 测试先在临时数据库和现有数据库副本执行，确认记录数与旧行为不变。

### 6.2 新增结构化事实

| 表 | 关键字段 | 约束与用途 |
| --- | --- | --- |
| `harness_runs` | `id`, `production_run_id`, `task_id`, `session_path`, `prompt_version`, `model`, `status`, `stop_reason`, budgets/counters, timestamps | 一次 Factory Harness 执行；`production_run_id` 唯一；Session 路径受控 |
| `factory_tasks` | `id`, `run_id`, `objective`, `status`, `attempt`, `max_attempts`, lease, error, timestamps | 最小持久任务；单 Worker 原子领取 |
| `work_plan_items` | `id`, `harness_run_id`, `position`, `text`, `status`, timestamps | 用户可见计划；同一位置唯一 |
| `tool_invocations` | `id`, `harness_run_id`, `tool_call_id`, `tool_name`, `args_json`, `permission`, `status`, `result_json`, timestamps | `harness_run_id + tool_call_id` 唯一，保证一调一果 |
| `background_jobs` | `id`, `task_id`, `kind`, `pid`, `status`, `command_summary`, `exit_code`, output paths, timestamps | 慢任务事实；不保存秘密和完整敏感命令 |
| `artifacts` | `id`, `run_id`, `kind`, `path`, `sha256`, `mime_type`, `size`, `status`, timestamps | 文件索引；文件在受控目录，SQLite 不存大内容 |
| `evidence` | `id`, `run_id`, `criterion_id`, `kind`, `artifact_id`, `observation_json`, `passed`, timestamp | 完成目标证据；失败证据不可删除 |

所有 JSON 写入前用 Zod 校验。数据库保存脱敏参数摘要；完整 stdout/stderr 大于 32 KB 时写报告文件并登记 Artifact。

### 6.3 文件资产

| 资产 | 位置 | 规则 |
| --- | --- | --- |
| Pi Session | `data/harness-sessions/<runId>.jsonl` | 原子追加；SQLite 保存相对路径和哈希；不得包含三份手册全文副本 |
| 工作区 | `data/workspaces/<runId>/` | 从 fixture 复制；canonical path 必须位于根目录内；结束后默认保留到人工验收完成 |
| 命令输出 | `data/reports/<runId>/commands/` | stdout/stderr 分开；日志脱敏；超限截断同时保留文件 |
| 测试报告 | `data/reports/<runId>/tests/` | 退出码、失败项、耗时和命令版本 |
| diff | `data/reports/<runId>/diff.patch` | 由 Git inspect 生成，只含目标工作区 |
| 浏览器截图 | `data/reports/<runId>/browser/` | 不截取 Key 或 `.env` |

### 6.4 状态模型

```text
HarnessRun:
ready → running → verifying → succeeded
            ↘ waiting_user
            ↘ failed
            ↘ cancelled
            ↘ interrupted

FactoryTask:
pending → in_progress → completed
                    ↘ blocked | failed | cancelled | interrupted

BackgroundJob:
queued → running → succeeded | failed | cancelled | interrupted
```

- Worker 启动时把遗留 `running` 后台进程标为 `interrupted`，保留输出与重试入口；
- 本阶段允许从完整 Session、工作区和证据重新创建一次安全重试，但不承诺任意 checkpoint 自动续跑；
- 只有 `CompletionVerifier` 返回 `complete` 才能进入 `succeeded`；
- 空结果、工具未配对、测试未通过或证据缺失一律不能显示确认或成功。

## 七、API 与工具设计

### 7.1 统一错误结构

```json
{
  "error": {
    "code": "stable_error_code",
    "message": "给用户看的简洁说明",
    "requestId": "可选追踪号",
    "retryable": false
  }
}
```

错误响应和 SSE 终态都使用同一结构，不暴露堆栈、供应商原始响应、Key 或完整用户文档。

### 7.2 Web API

| 方法与路径 | 请求 | 成功响应 | 错误与幂等 |
| --- | --- | --- | --- |
| `GET /api/runs/:id` | 无 | run、harness、plan、artifacts、evidence 摘要 | 404；未知状态安全兜底 |
| `GET /api/runs/:id/events?after=N` | 最后事件序号 | SSE：事件零到多条，以真实终态关闭 | 断线续读，不新建任务 |
| `POST /api/runs/:id/steer` | `{message, idempotencyKey}` | `{receipt}` | 仅 running；重复 key 返回原 receipt |
| `POST /api/runs/:id/abort` | `{reason, idempotencyKey}` | `{receipt}` | 仅活动执行；重复 abort 幂等 |

本阶段不开放任意 `stage`、任意工作区路径或任意生产单给浏览器。Harness 验证任务由已确认的服务端生产单创建。

### 7.3 ToolGateway 统一合同

```ts
type PermissionDecision = "allowed" | "approval_required" | "denied";
type ToolStatus = "succeeded" | "failed" | "approval_required" | "denied";

type ToolResultEnvelope = {
  toolCallId: string;
  toolName: string;
  status: ToolStatus;
  summary: string;
  data?: unknown;
  artifactIds: string[];
  evidenceIds: string[];
  startedAt: string;
  completedAt: string;
};
```

`PreToolUse` 固定顺序：schema → run/task 状态 → 工作区 canonical path → 风险等级 → 预算 → 权限决定 → invocation 预登记。`PostToolUse` 固定顺序：归一化结果 → 脱敏 → 保存大输出 → 登记证据 → 完成 invocation → 发送 ToolResult。

同一个 `(harnessRunId, toolCallId)` 只能完成一次；重复请求返回已保存结果，禁止重复副作用。

### 7.4 本阶段工具 schema

| 工具 | 输入 | 输出 | 权限与限制 |
| --- | --- | --- | --- |
| `manual.verify` | `{authorityVersion}` | 三份手册逐项 `path/hash/ok` | P0；任何失败立即 blocked |
| `manual.load` | `{stage:"v0.2-b"}` | 加载记录、字符数、哈希；原文进入受保护上下文 | P0；响应和日志不返回全文 |
| `workspace.list` | `{path, depth<=4, limit<=500}` | 相对路径、kind、size、mtime | P0；只在当前工作区；不跟随 symlink |
| `workspace.read` | `{path,startLine?,endLine?,maxBytes<=262144}` | 文本、行号、sha256、是否截断 | P0；二进制拒绝 |
| `workspace.search` | `{query,paths?,glob?,limit<=200}` | 相对路径、行号、片段 | P0；超限明确截断 |
| `workspace.patch` | `{patch,expectedHashes}` | 修改文件、前后 hash、diff 摘要 | P1；只允许 unified patch；hash 冲突失败；禁止删除 |
| `git.inspect` | `{operation:"status"|"diff"|"log",maxEntries?}` | 脱敏文本、退出码、是否 dirty | P0；只读子命令；不允许 remote/push/commit/reset/clean |
| `command.run` | `{program,args,cwd,timeoutMs}` | jobId 或 exitCode、stdout/stderr Artifact | P1；`spawn` + `shell:false`；程序与参数双白名单 |
| `test.run` | `{script:"test"|"typecheck"|"lint"|"build",cwd,target?}` | 报告、exitCode、失败项、耗时 | P1；映射 package script；不接受原始 Shell 字符串 |
| `workplan.update` | `{items:[{id,text,status}]}` | 当前计划快照 | P1；只能改本轮计划，不能改阶段 |
| `task.manage` | `{action:"get"|"update",taskId,status?,note?}` | Task 快照 | P1；模型不能自建越权生产单 |
| `background.manage` | `{action:"get"|"cancel",jobId}` | Job 快照 | P1；取消仅当前 Task 的进程 |
| `artifact.register` | `{kind,path,mimeType,sourceToolCallId}` | id、hash、size、status | P1；路径必须存在且在受控根目录 |
| `evidence.register` | `{criterionId,kind,artifactId?,observation,passed}` | Evidence id | P1；失败证据不可覆盖或删除 |

### 7.5 P0–P3 决策

| 等级 | 本阶段例子 | 行为 |
| --- | --- | --- |
| P0 只读 | 手册校验、文件读、搜索、Git status/diff/log | 自动允许并审计 |
| P1 受控可逆 | fixture 工作区 patch、允许的 test/build、计划和证据登记 | G6 通过后的有效生产单内自动允许 |
| P2 重大影响 | 删除、安装依赖、Git commit/push、外部发送、费用、发布 | 返回 `approval_required`，本阶段不执行并终止当前 Harness |
| P3 永久禁止 | 读取 `.env`、密钥目录、工作区逃逸、破坏手册、绕过策略 | 返回 `denied`，不可由普通确认放行 |

`command.run` 使用 `spawn(program,args,{shell:false})`，不拼接命令字符串。工作目录和所有文件路径先解析为 canonical path，再验证仍位于本次授权工作区。

## 八、Prompt 设计与版本

### 8.1 Prompt 资产

| Prompt | 版本 | 角色 |
| --- | --- | --- |
| `factory-harness-system` | `v1.0.0` | 冻结身份、权威顺序、工具边界、完成规则 |
| `v02b-production-order` | `v1.0.0` | 注入本阶段 objective、inputs、constraints、budgets 与 acceptance |
| `stage-report` | `v1.0.0` | 要求最终只报告已登记产物、证据、限制和下一步 |

每次运行记录 Prompt 版本与 SHA256。Prompt 修改生成新版本，不覆盖已经开始的运行。

### 8.2 系统 Prompt 必含内容

```text
身份：单 Factory Agent，只在当前生产单和工作区内工作。
权威：三份手册全文 > 已确认 PRD/G2–G5 > G6 生产单与完成目标 > 工作区事实。
过程：先 manual.verify/load，再查看任务与工作区，再建立 WorkPlan；所有行动通过工具。
安全：遵守 P0–P3；P2 停止并请求用户，P3 拒绝；不读取或输出秘密。
修复：工具或测试失败是观察，不是完成；读取失败原因，在预算内修复和复测。
完成：模型停止不等于完成；只有登记的 Artifact、Evidence 和 CompletionVerifier 可以证明完成。
退出：预算、权限、能力或外部依赖不足时返回明确 failed/blocked/waiting_user，不编造成功。
```

### 8.3 结构与校验

- 工具参数由 TypeBox 在进入执行前校验；
- 工具结果由应用 schema 归一化并登记；
- WorkPlan、Task、Artifact、Evidence 和完成结论由 Zod 校验；
- 最终自然语言报告不直接改变状态；
- 细微文案瑕疵记录为人工质量项，不通过无限重试修复；
- 空文本、未配对工具结果或未知 ToolResult 一律视为执行失败。

## 九、最小 WebUI 纵向切片

### 9.1 页面目标

在现有运行详情页增加一个简单的 Harness 面板，让产品负责人不用看终端就能回答：现在在做什么、刚做了什么、为什么停、证据在哪里、下一步是什么。

### 9.2 只保留的交互

- 当前真实状态与一句话目标；
- WorkPlan，突出当前项；
- 最近 20 条工具/任务事件，固定高度，上下滚动；
- 测试结果：首次失败与最终通过分开显示；
- Artifact 与 Evidence 列表；
- “停止本次运行”按钮；
- 运行中可发送一条 steer 指令；
- blocked / failed / interrupted 时显示真实原因和安全重试提示；
- P2 出现时显示影响说明，但本阶段没有“直接执行危险动作”的按钮；
- 只有 CompletionVerifier 成功后才显示成功，不把等待时长当完成。

### 9.3 页面状态矩阵

| 状态 | 页面展示 | 可操作 |
| --- | --- | --- |
| loading | 正在读取真实运行 | 无 |
| running | 当前计划、最新事件、真实耗时 | steer、停止 |
| waiting_user | 所需决定、影响和未执行说明 | 本阶段仅返回流程修改入口 |
| failed | 失败工具、错误摘要、已保留产物 | 安全重试 |
| interrupted | Worker 中断、已保存位置 | 创建安全重试 |
| succeeded | diff、首次失败、最终测试、证据 | 查看产物 |
| empty/not_found | 明确无运行或不存在 | 返回项目，不显示假结果 |

### 9.4 浏览器目标

- 桌面：1280px、1440px；
- 移动：390px；
- 键盘可触达停止与输入；
- Console 无持续错误；
- Network 无重复创建 Task；
- SSE 断开重连后按序号续读，不重复事件；
- 侧栏、面板和事件列表不会把主要操作挤出屏幕。

## 十、测试要求

### 10.1 第一层：mock 自动化测试

#### ManualAuthority

- 三份手册全部存在且哈希匹配时按固定顺序加载；
- 任一缺失或哈希不符时 blocked，且不调用模型；
- 加载记录只含路径、hash、字符数，不含原文；
- `.env` 和三份原文不会进入工具日志或 Artifact。

#### ToolGateway 与权限

- schema 不合法时工具不执行；
- 路径逃逸、绝对外部路径和 symlink 逃逸均 P3 denied；
- P0 自动允许；G6 未通过时 P1 拒绝；有效生产单内 P1 自动允许；
- 删除、push、发布、付费和外部发送为 P2 approval_required 且零副作用；
- 读取 `.env` 为 P3 denied；
- 同一 toolCallId 重放返回原结果，不重复 patch 或命令；
- 每个 tool start 必有唯一 terminal result，失败也配对。

#### Workspace / Git / Command / Test

- list/read/search 只返回工作区内数据并正确截断；
- patch 校验 expected hash、保留行尾、拒绝删除和冲突；
- git.inspect 只允许 status/diff/log；
- command.run 使用 shell=false，拒绝 metacharacter 绕过与非白名单程序；
- 超时和 abort 能终止子进程并登记结果；
- test.run 保存退出码、失败项和报告 Artifact。

#### Task / Background / Records

- 单 Worker 原子领取 Task；
- 运行中 Task 不被第二次领取；
- 活动后台任务结束、失败、取消均产生唯一终态；
- Worker 重启扫描后把孤儿 job 标为 interrupted；
- migration 在空库、当前 schema 副本和重复执行三种情况下通过；
- migration 前后已有 projects/runs/events 数量和内容一致；
- Artifact hash 与真实文件一致；失败 Evidence 不可覆盖。

#### Agent Loop

使用可控模型/Session 驱动固定工具序列：

```text
manual.verify → manual.load → workplan.update
→ workspace.read → workspace.patch
→ test.run(failed) → workspace.read
→ workspace.patch → test.run(passed)
→ git.inspect(diff) → artifact.register → evidence.register
```

断言首次失败事件真实存在、Agent 在失败后继续、最终复测通过、工具调用/结果全配对、完成验证只接受最终证据。

### 10.2 第二层：真实 DeepSeek 冒烟

真实 Key 冒烟必须在新的独立工作区执行：

1. 从只读 fixture 复制到 `data/workspaces/<runId>/` 并初始化本地 Git；
2. 使用真实 `deepseek-v4-flash` 与生产 Prompt；
3. 让 Agent 读取一个小型 TypeScript 模块和验收目标；
4. 允许 P0/P1 工具，不提供 P2/P3；
5. 最终必须产生真实 diff、测试报告、Artifact 与 Evidence；
6. 记录模型、Prompt 版本、首个事件时间、总耗时、输入/输出/cache Token、重试、估算费用和终态；
7. 认证、超时、限流、空结果或结构错误如实失败，不用 mock 冒充；
8. 冒烟后确认 Key 未出现在 Session、SQLite、报告、截图和 Git diff 中。

真实冒烟不强制“第一次修改一定失败”；`读取 → 修改 → 测试失败 → 修复 → 复测` 的确定性证据由 mock 集成闭环保证。真实冒烟验证同一工具契约、真实模型、真实文件和最终完成证据。

### 10.3 自动检查

阶段实现完成后必须全部运行：

```bash
npm run manuals:verify
npm run lint
npm run typecheck
npm run test
npm run build
```

任何失败不得通过删除测试、降低标准或隐藏输出解决。

### 10.4 真实浏览器验收

启动 Web 与 Worker，使用真实后端状态检查：

- 运行开始后页面显示 running 与真实计划；
- 最近事件区最多可见 20 条并在固定高度滚动；
- 测试失败时不弹成功或确认；
- 修复后最终复测和证据可查看；
- abort 后状态为 cancelled，后台进程结束；
- 刷新后从 SQLite 恢复任务、计划、产物和事件；
- SSE 临时断开不创建第二个 Harness；
- 390px、1280px 和 1440px 均能完成核心操作；
- Console 无错误，Network 无失败和重复提交。

## 十一、产品负责人验收清单

G6 代码实现完成后，AI 必须逐条带产品负责人操作，而不是一次性丢出技术命令：

- [ ] 打开 AI 产品工厂本地页面，进入“Harness 验证”运行；
- [ ] 我能看到当前目标、真实状态和正在做的计划项；
- [ ] 工具记录区域只显示最近 20 条，固定高度内可以上下滚动；
- [ ] 我能看到 Agent 先读取文件，再修改文件；
- [ ] 第一次测试失败时，页面明确显示失败，没有弹出确认或成功；
- [ ] Agent 能根据真实失败结果继续修复；
- [ ] 第二次测试通过后，我能看到最终 diff、测试报告和证据；
- [ ] 刷新页面后，计划、失败记录、最终结果和产物仍然存在；
- [ ] 点击停止后运行真正取消，不继续显示 running；
- [ ] 危险或越界工具请求没有执行，并显示被拦截原因；
- [ ] 页面没有显示 API Key、`.env` 内容或三份手册全文；
- [ ] AI 报告了 mock 测试、真实 DeepSeek 冒烟、Lint、类型、测试、构建和浏览器检查的真实结果；
- [ ] 任何未通过项都被明确列出，没有被标记为完成。

## 十二、风险、失败出口与待确认项

### 12.1 风险与处理

| 风险 | 处理 | 失败出口 |
| --- | --- | --- |
| Pi Harness API 与现有 AgentRuntime 差异 | 新增 Adapter，保留旧 Interface 兼容测试；不让 Pi 类型扩散到 Web | 适配失败则保留旧运行，阶段 blocked |
| JSONL Session 与 SQLite 双存储混淆 | SQLite 是生产事实，JSONL 是 Harness transcript；用 runId 和 hash 关联 | 任一索引不一致不判完成 |
| 模型无限循环或费用失控 | turn/tool/time/token/cost 五类预算，有限重试，超限终止 | `budget_exhausted`，保留证据 |
| Shell 或路径越界 | shell=false、双白名单、canonical path、symlink 检查 | denied，零副作用 |
| Worker 崩溃 | Session、Task、tool result、Artifact、Evidence 持久化；孤儿任务 interrupted | 用户可安全重试；自动 checkpoint 恢复留后续 |
| 迁移损坏数据 | 备份、事务、checksum、现有库副本测试 | 恢复备份，停止启动 |
| 空模型结果导致假确认 | CompletionVerifier 与 `hasConfirmableAgentResult` 双保护 | failed，不创建确认 |
| 真实冒烟 Key 缺失 | mock 继续开发，验收保持待验 | G6 不得通过 |
| 前端把断线当结束 | 后端状态为唯一事实，SSE 按序号续读 | 显示 disconnected/recovering |

### 12.2 统一退出原因

```text
complete
failed
blocked
waiting_user
cancelled
interrupted
budget_exhausted
```

每个退出必须记录 `reasonCode`、用户可理解说明、已完成产物、未完成标准和安全下一步。模型文字不得直接写终态。

### 12.3 需要产品负责人决定的问题

无新增外部平台、费用、终端、用户范围或数据上传决定。

本次 G6 只需要确认：是否按本文范围、`docs/18` 的生产单预算和 `docs/19` 的完成目标进入代码实施。

## 十三、交接给下一阶段

本阶段通过后，V0.2-C 可以直接复用：

- FactoryHarness 和 Pi AgentHarness Adapter；
- ToolGateway、P0–P3、Hooks 与工具配对记录；
- ManualAuthority；
- Task、BackgroundJob、WorkPlan、Artifact、Evidence schema；
- 独立工作区 Adapter 与安全测试；
- WebUI 真实运行状态切片；
- Prompt、生产单和完成目标版本机制。

下一阶段新增：完整 Workflow Definition、Task DAG、journal、checkpoint、租约恢复、P2 决定后恢复、完整 GoalGate 与 G6–G7 闭环。下一阶段不得为了扩展而改写本阶段已验证的 ToolGateway 安全合同。

## 十四、G6 开工确认

- [ ] 阶段只做最小可执行 Harness，不做完整 Workflow/Goal Gate；
- [ ] 使用 Pi `AgentHarness` 作为唯一 Loop，不创建第二套 Loop；
- [ ] 工具、路径、命令、P0–P3、预算和失败出口符合预期；
- [ ] SQLite 只做编号增量迁移，并先备份和验证现有数据；
- [ ] mock 闭环必须真实经历测试失败、修复和复测；
- [ ] 真实 DeepSeek 冒烟、浏览器验收和五项自动检查缺一不可；
- [ ] 小游戏、非游戏试产、公开部署、push 和危险动作继续不在本阶段；
- [ ] 只有 `docs/19` 的全部证据成立才算阶段完成。

产品负责人确认本清单以及 `docs/18`、`docs/19` 后，G6 才正式通过并开放本文范围内的生产代码修改。
