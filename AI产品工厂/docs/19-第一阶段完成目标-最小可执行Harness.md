# 第一阶段完成目标｜最小可执行 Harness

> 完成目标状态：G6 待产品负责人确认
>
> 完成目标 ID：`CG-V02B-HARNESS-001`
>
> 版本：`1.0.0`
>
> 配套文档：`docs/17-第一阶段技术开发文档-最小可执行Harness.md`、`docs/18-第一阶段生产单-最小可执行Harness.md`
>
> 判定原则：模型停止不等于完成。只有确定性验证器核对本文件全部必需证据后，阶段状态才能写为 `succeeded`。

## 1. 完成定义

本阶段完成意味着：

> AI 产品工厂已经拥有一个受三份手册、生产单、预算和 P0–P3 权限约束的单 Factory Harness。它能在独立测试工作区内连续调用工具，真实观察第一次测试失败，基于失败修复并复测通过；所有工具调用与结果、计划、任务、产物和证据可追溯；真实 DeepSeek、真实浏览器与工程检查均有通过证据。

以下事实必须同时成立：

```text
manualsVerified
AND singlePiAgentHarness
AND toolGatewaySafe
AND deterministicFailureRepairLoopPassed
AND taskAndBackgroundFactsPersisted
AND artifactsAndEvidenceComplete
AND completionVerifierPassed
AND realDeepSeekSmokePassed
AND realBrowserAcceptancePassed
AND repositoryChecksPassed
AND existingDataPreserved
AND secretsNotLeaked
```

任何一项为 false、unknown 或 missing，结果都不是 complete。

## 2. 成功状态

### 2.1 唯一成功终态

```yaml
status: succeeded
reasonCode: completion_goal_satisfied
completionGoalId: CG-V02B-HARNESS-001
completionGoalVersion: 1.0.0
```

写入该状态前，`CompletionVerifier` 必须输出：

```ts
type CompletionDecision =
  | {
      decision: "complete";
      criterionResults: CriterionResult[];
      evidenceIds: string[];
      verifiedAt: string;
    }
  | {
      decision: "continue" | "failed" | "blocked" | "waiting_user";
      satisfied: string[];
      missing: string[];
      failed: string[];
      nextAction: string;
    };
```

模型只能提交候选报告，不能直接写 `decision: complete` 或数据库终态。

### 2.2 阶段成功后的边界

成功只证明 V0.2-B 最小 Harness 成立，不证明：

- 完整 Workflow、checkpoint 和崩溃自动恢复已经完成；
- 完整 GoalGate 和 G7 已完成；
- 小游戏已经能生产；
- 工厂已经适配所有产品；
- 正式前端、登录、多用户、云部署或公开发布已经完成。

## 3. 必需完成标准与证据

### CG-01 三份手册权威完整

必须满足：

- `npm run manuals:verify` 通过；
- ManualAuthority 单测覆盖成功、缺失、hash 错误；
- 缺失/hash 错误时模型调用次数为 0、工作区写入次数为 0；
- 三份手册内容和 SHA256 未改变；
- 原文没有被复制到公开文件、Session、数据库事件或交付报告。

必需证据：

- `EV-MANUALS-VERIFY`：命令、退出码、三项 OK；
- `EV-MANUALS-GUARD`：失败路径测试报告；
- `EV-MANUALS-DIFF`：手册 hash 与 Git 范围检查。

### CG-02 单一 Pi Agent Harness

必须满足：

- 生产执行使用 Pi `AgentHarness@0.84.2`；
- FactoryHarness 只是领域 Wrapper 和 Adapter；
- run、steer、abort、completed/aborted/failed/suspended 均有映射测试；
- 工具执行为 sequential；
- 没有第二套自定义 Agent while-loop。

必需证据：

- `EV-HARNESS-INTERFACE`：接口与事件映射测试；
- `EV-HARNESS-ARCH`：变更清单和依赖方向检查。

### CG-03 ToolGateway 与 P0–P3

必须满足：

- 所有工具先 schema 校验、再权限裁决、后执行；
- workspace canonical path 永远位于授权根内；
- symlink、绝对外部路径和 `..` 逃逸被拒；
- `.env`、秘密路径与手册破坏为 P3 denied；
- P2 产生 approval_required，实际副作用计数为 0；
- command 使用 `shell:false` 和程序/参数白名单；
- 重复 toolCallId 返回同一结果，不重复副作用；
- 每个 started tool 都有且只有一个 terminal result。

必需证据：

- `EV-PERMISSION-MATRIX`：P0–P3 参数化测试；
- `EV-PATH-ESCAPE`：path/symlink/secret 拒绝测试；
- `EV-COMMAND-POLICY`：raw shell 与非白名单拒绝测试；
- `EV-TOOL-PAIRING`：调用/结果配对和幂等测试。

### CG-04 最小持久 Task 与 BackgroundRunner

必须满足：

- Task 创建、原子领取、状态更新和错误持久化；
- 一个运行中 Task 不能被第二 Worker 重复领取；
- Background job 可查询、取消，stdout/stderr 有受控 Artifact；
- 超时和 abort 会终止子进程并产生唯一终态；
- Worker 重启扫描能把孤儿 running job 标为 interrupted；
- 刷新页面后 Task、计划、事件和产物仍可读取。

必需证据：

- `EV-TASK-CLAIM`：并发领取测试；
- `EV-BACKGROUND-LIFECYCLE`：成功、失败、超时、取消、中断测试；
- `EV-REFRESH-RECOVERY`：重建 Store 后读取同一记录的测试与浏览器证据。

### CG-05 数据迁移与现有数据保护

必须满足：

- `schema_migrations` 与编号迁移可重复执行；
- 执行 `0002-minimum-harness` 前存在一致性备份；
- 迁移失败时原库可用、版本未错误前进；
- 现有 projects、production_events、production_runs、run_events 的行数和关键内容不减少；
- WAL、foreign_keys 和索引继续有效；
- 没有 drop、delete-all 或重建现有数据库。

必需证据：

- `EV-MIGRATION-EMPTY`：空库迁移测试；
- `EV-MIGRATION-EXISTING`：现有 schema 副本迁移报告；
- `EV-MIGRATION-IDEMPOTENT`：重复执行测试；
- `EV-DATA-PRESERVED`：迁移前后计数/hash 摘要；
- `EV-DATABASE-BACKUP`：备份文件 Artifact、size、SHA256。

### CG-06 确定性“失败—修复—复测”闭环

mock 集成闭环必须按顺序留下以下事实：

1. `manual.verify` 成功；
2. `manual.load` 成功；
3. WorkPlan 已创建；
4. Agent 读取 fixture 工作区；
5. 第一次 workspace.patch 成功；
6. 第一次 test.run 的 exitCode 非 0；
7. 失败报告已持久化，页面状态不是 succeeded/waiting_approval；
8. Agent 在失败 ToolResult 之后再次读取或分析真实失败；
9. 第二次 workspace.patch 成功；
10. 第二次 test.run 的 exitCode 为 0；
11. git diff、测试报告和证据已登记；
12. CompletionVerifier 才返回 complete。

必需证据：

- `EV-LOOP-EVENT-SEQUENCE`：带 sequence 的事件列表；
- `EV-FIRST-TEST-FAILED`：首次测试报告 Artifact；
- `EV-SECOND-TEST-PASSED`：最终测试报告 Artifact；
- `EV-FIXTURE-DIFF`：独立工作区 diff；
- `EV-COMPLETION-AFTER-EVIDENCE`：完成判定时序测试。

测试可以用受控模型脚本保证序列确定，但文件、patch、命令、测试、SQLite 和 Artifact 必须使用真实实现，不得把这些层全部 mock 掉。

### CG-07 Artifact 与 Evidence 可追溯

必须满足：

- 每个必需 Artifact 有 runId、kind、相对路径、size、SHA256、来源 toolCallId 和时间；
- 每条 Evidence 绑定 criterionId、观察、passed、Artifact 引用和时间；
- 大输出不塞入 SQLite；
- 失败 Evidence 不删除、不覆盖；
- 文件丢失或 hash 不一致时 CompletionVerifier 拒绝完成。

必需证据：

- `EV-ARTIFACT-HASH`：文件与数据库 hash 对照测试；
- `EV-EVIDENCE-IMMUTABLE`：失败证据不可覆盖测试；
- `EV-MISSING-ARTIFACT`：缺失文件时完成拒绝测试。

### CG-08 真实 DeepSeek 冒烟

必须满足：

- 使用真实 `DEEPSEEK_API_KEY`，但 Key 不出现在任何输出；
- 使用启动时验证存在的 `deepseek-v4-flash`；
- 真实模型调用至少触发一次受控工具并形成最终工作区结果；
- 最终测试通过、Artifact 和 Evidence 可读取；
- 记录模型、Prompt 版本、总耗时、Token、cache、重试和估算费用；
- 总估算费用不超过生产单预算；
- 认证或模型失败时如实失败，不用 mock 报告替代。

必需证据：

- `EV-DEEPSEEK-SMOKE`：脱敏冒烟报告；
- `EV-DEEPSEEK-USAGE`：用量和费用摘要；
- `EV-SECRET-SCAN`：Session、SQLite 摘要、报告和 diff 的秘密扫描结果。

### CG-09 最小 WebUI 真实可用

必须满足：

- 运行详情显示真实 objective、status 和当前 WorkPlan；
- 工具/任务区最多展示最近 20 条，固定高度内上下滚动；
- 首次测试失败明确显示 failed observation，不弹确认或成功；
- 最终通过后可查看 diff、测试 Artifact 和 Evidence；
- abort 真正改变后端状态并终止活动 job；
- 刷新后从后端恢复，不依赖 Local Storage 冒充；
- SSE 断线按 sequence 恢复，不创建重复 Task；
- 390px、1280px、1440px 均可操作；
- Console 无错误，Network 无未解释失败和重复请求。

必需证据：

- `EV-BROWSER-DESKTOP`：1280/1440 浏览器报告与截图；
- `EV-BROWSER-MOBILE`：390 浏览器报告与截图；
- `EV-BROWSER-FAILURE-STATE`：首次失败无确认的截图；
- `EV-BROWSER-REFRESH`：刷新恢复记录；
- `EV-BROWSER-ABORT`：取消真实生效记录；
- `EV-BROWSER-CONSOLE-NETWORK`：Console/Network 检查摘要。

### CG-10 仓库质量与范围

必须满足：

- manuals verify、lint、typecheck、test、build 全部退出码 0；
- 未删除已有测试；
- 未降低 `hasConfirmableAgentResult` 的空结果保护；
- 没有未解释的 TypeScript、ESLint、Vitest 或 Next.js 警告；
- Git diff 只含当前阶段文件；
- 根目录 `agent-blueprint/`、三份手册、`.env`、SQLite 和 data 产物没有进入提交范围；
- README 更新启动、配置、验证与已知限制。

必需证据：

- `EV-MANUALS-FINAL`；
- `EV-LINT`；
- `EV-TYPECHECK`；
- `EV-TEST`；
- `EV-BUILD`；
- `EV-GIT-SCOPE`；
- `EV-README`。

## 4. 必需 Artifact 总表

| Artifact | 必需 | 允许替代 |
| --- | --- | --- |
| 迁移前数据库备份 | 是 | 无 |
| 迁移报告 | 是 | 无 |
| mock 闭环事件序列 | 是 | 无 |
| 首次失败测试报告 | 是 | 无 |
| 最终通过测试报告 | 是 | 无 |
| fixture 工作区 diff | 是 | 无 |
| P0–P3 安全报告 | 是 | 无 |
| 真实 DeepSeek 冒烟报告 | 是 | 无；mock 不可替代 |
| 浏览器验收报告与截图 | 是 | 无；build 不可替代 |
| manuals/lint/typecheck/test/build 报告 | 是 | 无 |
| 已知问题与 V0.2-C 交接 | 是 | 无 |

Artifact 只存在文件名但打不开、hash 不一致、内容为空或来源不明，等同于缺失。

## 5. 限制条件

### 5.1 权限限制

- 只允许 G6 通过后的当前阶段 P0/P1；
- P2 停止并等待重新确认，不原地执行；
- P3 永久拒绝；
- 只允许本项目与独立 fixture 工作区；
- 不允许 Git commit/push、发布或外部发送。

### 5.2 预算限制

使用 `docs/18` 的 token、费用、时间、turn、tool、patch、test 和 retry 上限。任一耗尽均不能判 complete。

### 5.3 数据限制

- 三份手册、`.env`、Key、SQLite 数据文件和 data 产物不提交；
- 现有 SQLite 只增量迁移；
- 二进制和大日志存文件，SQLite 保存索引；
- Session JSONL 不作为阶段终态的唯一事实来源。

### 5.4 产品范围限制

小游戏、非游戏通用性、完整 Workflow、完整 GoalGate、正式终端、登录、公开部署均不是本完成目标的一部分，也不能用来补偿本阶段缺失证据。

## 6. 非完成状态与出口

### 6.1 continue

适用条件：预算仍有剩余，缺失项可通过当前 P0/P1 工具补齐。

必须输出：已满足、缺失、下一项具体工具行动。不得只说“继续优化”。

### 6.2 failed

适用条件：实现、工具、测试、构建、浏览器或真实模型失败，且在当前预算内无法修复。

必须输出：失败 criterion、失败 Evidence、已保存 Artifact、可重试性和最小修复建议。

### 6.3 blocked

适用条件：手册、Key、环境、必要输入或外部条件缺失。

必须输出：唯一阻塞条件、用户具体需要做什么、补齐后从哪里继续。blocked 不能展示为“仍在生成”。

### 6.4 waiting_user

适用条件：出现 P2 或会改变范围、费用、数据、终端的决定。

必须输出：请求动作、影响、费用、恢复方式和零副作用证明。本阶段不会自动执行。

### 6.5 cancelled

适用条件：用户 abort。

必须输出：取消时间、已终止的 Agent/Job、已保留的产物和重新开始方式。

### 6.6 interrupted

适用条件：Worker、进程或机器中断。

必须输出：最后持久 Task、最后完成工具结果、Session 路径、孤儿 job 状态和安全重试入口。不声称任意 checkpoint 自动恢复。

### 6.7 budget_exhausted

适用条件：任一预算达到上限。

必须输出：哪项预算、实际用量、已满足标准、缺失标准和是否建议调整预算。调整预算需要重新确认生产单。

## 7. 明确不构成完成的信号

以下任一项单独出现均不构成完成：

- `agent_end` 或 LLM `stopReason=stop`；
- 模型说“已经完成”；
- 模型没有继续调用工具；
- 页面等待时间超过阈值；
- SSE 连接断开；
- Worker 当前没有日志输出；
- 生成了一段很长的文字；
- 创建了 Artifact 记录但文件不存在；
- mock 测试通过但真实 DeepSeek 未跑；
- build 通过但浏览器未验收；
- 最终测试通过但没有第一次失败—修复证据；
- 用户没有回复或没有发现问题；
- 代码已经写完但现有数据、手册或秘密保护未验证。

前端不得从这些信号推导 succeeded 或弹出确认。

## 8. CompletionVerifier 判定顺序

```text
1. 读取完成目标版本与生产单版本
2. 检查运行终态候选不是 failed/blocked/cancelled/interrupted
3. 检查 budgets 未耗尽
4. 检查 CG-01..CG-10 每项 Evidence 存在
5. 校验 Evidence 引用 Artifact 存在、可读、hash 匹配
6. 校验工具调用/结果一一配对且无 pending
7. 校验后台 job 全部终态
8. 校验 mock 事件顺序包含失败→修复→复测
9. 校验真实 DeepSeek 与浏览器证据不是 mock
10. 校验五项仓库检查为最新代码版本
11. 输出 complete 或明确的非完成出口
12. 只有 complete 才由 ProductionController 写 succeeded
```

检查顺序中的后续步骤不能掩盖前面的失败；任何验证异常本身作为 failed Evidence 保存。

## 9. 产品负责人最终验收

产品负责人不需要看代码，只需在 AI 引导下确认：

- [ ] 我亲眼看到第一次测试失败时系统没有显示完成；
- [ ] 我亲眼看到 Agent 根据失败继续修复并最终复测通过；
- [ ] 我能打开 diff、首次失败报告、最终通过报告和证据；
- [ ] 刷新页面后这些记录仍在；
- [ ] 停止按钮真实有效；
- [ ] 危险/越界请求被拦截，没有副作用；
- [ ] 真实 DeepSeek 冒烟已经执行并报告用量，不是 mock；
- [ ] 真实浏览器、手机宽度、Console 和 Network 已检查；
- [ ] 三份手册、现有数据、`.env` 和 Key 没有被改坏或公开；
- [ ] AI 明确列出本阶段仍不具备的完整恢复、GoalGate、小游戏和部署能力。

全部勾选后，产品负责人可以接受 V0.2-B 阶段结果；这仍不会自动开始 V0.2-C 或任何发布。

## 10. G6 确认

- [ ] 成功状态只有一个且由确定性代码写入；
- [ ] CG-01–CG-10 每项都有可检查的必需证据；
- [ ] mock、真实模型、真实浏览器和仓库检查不能互相替代；
- [ ] 失败、阻塞、等待用户、取消、中断和预算耗尽出口明确；
- [ ] 模型停止、等待超时和空结果明确不等于完成；
- [ ] 成功范围没有扩张到 Workflow、GoalGate、小游戏或部署。

产品负责人确认后，本完成目标与生产单一同冻结为 G6 `approved` 版本；后续修改目标、预算或证据要求必须产生新版本并重新确认。
