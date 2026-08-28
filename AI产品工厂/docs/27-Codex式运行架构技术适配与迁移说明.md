# AI 产品工厂｜Codex 式运行架构技术适配与迁移说明

> 日期：2026-08-27
>
> 状态：第一阶段迁移已实现，保留原产品需求与 G1–G9 业务流程
>
> 参照：OpenAI `openai/codex` 仓库提交 `b592a0bfed439386fadc69327bd49eccb074cdc6`
>
> 边界：借鉴运行架构，不复制 Codex 品牌、界面、Rust 实现或产品定义

## 1. 产品形态判断

产品仍是面向产品负责人本人的通用 AI 产品工厂：用户输入需求或 PRD，系统逐阶段生成真实产物并确认，Pi Agent + DeepSeek 在受控工作区执行，确定性控制器掌管阶段、完成、权限和发布候选。小游戏只是首个试产对象。

本次变化只解决运行架构耦合：此前 Worker 同时负责工位选择、模型运行、事件格式、状态转换和确认边界，继续扩展会让恢复、客户端接入和工具审批越来越难验证。

## 2. 采用的架构方案

| 关注点 | Codex 官方证据 | 本项目采用 |
| --- | --- | --- |
| 协议优先 | `Submission { id, op }` 与 `Event { id, msg }` 分离请求和事件；`Op`、`EventMsg` 是显式协议 | 新增 `@factory/protocol`，定义版本化 Command、Event、Thread、Turn 身份 |
| Core 与客户端分离 | `CodexThread` 是双向消息通道；TUI、exec、app-server 是不同客户端/传输 | 新增 `@factory/runtime-core`，Web、Worker、未来 CLI 只通过协议和端口接入 |
| Thread / Turn 生命周期 | `ThreadManager` 管创建、恢复和在内存中的线程；app-server 提供 `thread/*`、`turn/*` 生命周期 | 产品项目映射 Thread；生产批次映射 Turn；阶段是 Turn 的业务属性 |
| 工具审批是协议事实 | `ExecApproval`、`PatchApproval` 和审批请求事件由协议承载 | 现有 ToolGateway P0–P3 保留；审批请求/结果进入协议事件，不由模型或页面猜测 |
| Provider 可替换 | `ModelProviderInfo` 集中 base URL、环境变量、重试和流超时 | 新增 `PiAgentFactory`，DeepSeek 成为适配器；Pi Agent 仍是主体运行时 |
| 持久与恢复 | Thread store、rollout、resume 和事件历史是独立能力 | 继续使用 SQLite + JSONL Session；协议事件与旧 UI 事件双写，支持按序续读 |

## 3. 触发的按需模块

- 版本化协议事件：解决 Worker、WebUI、持久化之间的隐式字符串耦合。
- 运行核心与处理器注册表：由确定性代码选择工位、校验结果并决定终态。
- 传输中立命令入口：Web Route Handler 不再直接拼 Harness 内部事件。
- 模型提供方适配器：DeepSeek 配置和 Pi Agent 创建集中在同一真实 seam。
- 兼容桥：旧 WebUI 暂时继续消费 `text.delta`、`gate.requested` 等事件，同时持久化 `protocol.*` 事件。

## 4. 偏离或暂缓

- 不迁移 Rust：现有 Node.js + TypeScript + Next.js + SQLite 已通过验证，整体换语言违反已有项目局部迁移原则。
- 不复制 Codex UI：本产品的用户任务是生产和确认数字产品，不是通用代码终端。
- 不替换 Pi Agent + DeepSeek：Codex 架构被用作边界设计参考，不改变已确认模型和 Agent 主体。
- 不一次性删除旧事件：当前页面和历史数据仍依赖旧事件；采用双写，待所有消费者迁移并完成数据兼容验证后再移除。
- 不引入微服务、远程队列或 PostgreSQL：第一版单用户、单 Worker，不存在足以证明这些复杂度的事实。

## 5. 强制底线检查

| 底线 | 结论 | 证据 |
| --- | --- | --- |
| 三份手册权威性 | 保持；原文未修改，运行前后继续 SHA 校验 | `npm run manuals:verify` |
| 固定流程由代码掌管 | 通过；`FactoryRuntimeCore` 唯一应用 Turn 终态 | `packages/runtime-core/src/index.ts` |
| 空结果不得确认 | 通过；Core 在进入审批前再次运行确定性 `hasConfirmableAgentResult` | runtime-core 单元测试 |
| 命令可追溯和幂等 | 通过；steer/interrupt 统一校验 Thread/Turn/idempotency key | `RuntimeCommandGateway` |
| 模型与秘密服务端化 | 保持；DeepSeek Key 只进入服务端 provider adapter | `packages/agent-runtime/src/model-provider.ts` |
| 权限与工具边界 | 保持；ToolGateway 与目标工作区路径裁决未下放给模型 | `packages/harness/src/tool-gateway.ts` |
| 数据可恢复 | 保持；旧事件与协议事件均进入 SQLite，Harness Session 仍使用 JSONL | records 与 Pi Harness adapter |
| 不做实际发布 | 保持；终点仍是 `candidate`，协议迁移未加入部署工具 | release handoff 流程与测试 |

## 6. 当前落地结构

```text
apps/web                    WebUI 与 HTTP/SSE 传输适配器
apps/worker                 工位实现与进程入口
packages/protocol           Command/Event 协议、版本、兼容映射
packages/runtime-core       Thread/Turn 核心、Handler 注册、终态裁决、命令入口
packages/production         产品阶段与人工闸门控制器
packages/agent-runtime      Pi Agent Runtime + DeepSeek Provider Adapter
packages/harness            ToolGateway、Workspace、CompletionVerifier
packages/records            SQLite、事件、任务、产物、证据与备份
packages/shared             产品领域 schema
```

依赖方向为：传输与进程入口 → Runtime Core / Production Controller → Protocol 与领域接口 → Records / Agent / Tool 适配器。页面不拥有业务状态，模型不拥有完成状态。

## 7. 状态、事件与恢复

- `threadId = ProductProject.id`：一台产品的持续生产上下文。
- `turnId = ProductionRun.id`：一个工位的一次生产尝试。
- Runtime Core 在执行前写 `thread.configured` 和 `turn.started`。
- 工位输出写 `item.started/delta/completed`，同时保留旧 UI 事件。
- 有真实结果才写 `approval.requested` 和 `turn.awaiting_approval`。
- 人工确认后写 `approval.resolved`、`turn.completed` 和 `checkpoint.created`。
- 失败、阻塞、中断分别写明确终态；刷新通过 SQLite 事件序号恢复。

## 8. API 与工具设计

- `/api/runs/:id/steer` 与 `/abort` 已改为构造统一 Protocol Command，再交给 `RuntimeCommandGateway`。
- SSE 仍返回同一持久事件序列，因此老前端无破坏；新客户端可只筛选 `protocol.*`。
- `/approve` 仍由 Production Controller 执行，因为人工闸门会改变下一阶段和项目状态，不能交给通用命令网关。
- ToolGateway 继续负责 schema、权限、路径、危险动作和真实工具结果；协议层只传递事实，不绕过策略层。

## 9. 测试与验收

第一阶段迁移新增协议和运行核心测试，覆盖：

- 事件包含协议版本、Thread、Turn 和可持久序号；
- 旧 UI 事件与新协议事件双写；
- 没有真实结果时禁止进入确认；
- 有结果时进入明确审批边界；
- steer 命令按 idempotency key 去重；
- 28 个测试文件、93 条自动测试继续全部通过（含新增协议、运行核心与 Hydration 回归测试）。

完整交付还需执行 lint、typecheck、Vitest、Playwright、veFaaS 构建和三手册复核；真实 DeepSeek 冒烟仅在没有额外付费风险且本地配置可用时执行并如实记录。

## 10. 迁移阶段

1. **已完成**：协议包、运行核心、工位注册、命令入口、审批协议事件、Provider Adapter、旧 UI 双写兼容。
2. **下一阶段**：让 WebUI 原生消费 Protocol Event，增加 Thread 快照投影和显式恢复命令。
3. **稳定后**：为旧事件制定迁移窗口，只有历史数据和所有客户端均通过兼容测试才删除双写。

## 11. 官方证据账本

| ID | 级别 | 来源 | 支撑结论 |
| --- | --- | --- | --- |
| E-CODEX-01 | confirmed | `openai/codex` README，提交 `b592a0b` | Codex CLI 是本地 Agent，官方仓库为 Apache-2.0 |
| E-CODEX-02 | confirmed | `codex-rs/protocol/src/protocol.rs:190,573,1317,1335` | Submission/Op 与 Event/EventMsg 构成双向协议 |
| E-CODEX-03 | confirmed | `codex-rs/core/src/codex_thread.rs` | CodexThread 是 Thread 的双向消息通道，Core 接受 Op |
| E-CODEX-04 | confirmed | `codex-rs/core/src/thread_manager.rs:223` | ThreadManager 管创建、恢复和活动线程 |
| E-CODEX-05 | confirmed | `codex-rs/app-server/README.md` | app-server 用 Thread/Turn/Item 生命周期服务富客户端 |
| E-CODEX-06 | confirmed | `codex-rs/model-provider-info/src/lib.rs:96` | Provider 配置集中管理地址、环境密钥、重试与流超时 |
| E-FACTORY-01 | confirmed | `apps/worker/src/index.ts` 迁移前基线 | Worker 原先集中工位选择、事件追加与状态转换 |
| E-FACTORY-02 | confirmed | `packages/harness`、`packages/records` | 项目已存在工具策略、SQLite、Evidence 和 JSONL Session，不应推倒重写 |

官方仓库：https://github.com/openai/codex 。本说明只记录可从源码确认的结构；没有证据的 Codex 内部云端能力不作为本项目设计依据。

## 12. 需要产品负责人决定的问题

无。本阶段没有改变产品定位、用户、模型、Agent 主体、数据去向、付费服务或发布边界，可以按已确认需求继续迁移和测试。
