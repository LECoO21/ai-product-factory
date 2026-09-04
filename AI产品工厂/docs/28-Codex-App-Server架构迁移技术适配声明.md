# AI 产品工厂｜Codex App Server 架构迁移技术适配声明

> 日期：2026-09-02
>
> 状态：产品负责人已确认，取代 `docs/27-Codex式运行架构技术适配与迁移说明.md` 中“继续使用 Pi Agent + DeepSeek”的目标方案。
>
> 范围：本轮只完成本地优先产品的运行时迁移、OpenAI 登录闸门和素材工位骨架；不执行真实发布。

## 1. 已确认方向

- Factory Agent 的唯一执行引擎改为 OpenAI Codex App Server。
- 删除 Pi Agent、DeepSeek Provider 和 `DEEPSEEK_*` 配置。
- 用户进入产品工厂前，必须通过 Codex App Server 登录自己的 ChatGPT/OpenAI 账户。
- 产品项目继续由确定性生产控制器管理阶段、确认、权限、证据和发布候选；Codex 不成为业务状态事实源。
- 图片、音频和 3D 素材成为独立生产工位，由 Codex 统一编排。
- 图片可使用 Codex 已提供的图片生成能力；音频和 3D 必须通过已配置的 Tool、MCP 或 CLI Adapter 生产。未配置时明确显示“能力未配置”，不得返回假素材。

## 2. 手册适配

| 手册要求 | 本轮采用方式 | 偏离与原因 |
| --- | --- | --- |
| 核心链路真实可运行、可恢复、可验证 | 保留 SQLite、SSE、Runtime Core、ToolGateway、Evidence 和人工闸门 | 仅替换 Agent 执行引擎，不重写控制平面 |
| 前端鉴权、状态、失败和恢复必须明确 | 登录页读取 `account/read`，通过 `account/login/start` 发起 ChatGPT OAuth；未登录时拦截页面和业务 API | 原默认邀请码登录由产品负责人明确改为 OpenAI 账户登录 |
| 密钥不得进入浏览器或仓库 | 不再要求用户填写模型 Key；认证凭据由 Codex 自身凭据存储管理，前端只读取脱敏账户状态 | 不复制、不记录访问令牌 |
| 多媒体产物统一登记和预览 | 统一使用 Artifact 模型；图片、音频、3D 分工位并保留能力状态 | 音频/3D 不是 Codex 原生输出，必须经过外部执行 Adapter |
| 发布前必须满足登录隔离、持久化和监控 | 本轮只生成发布准备流程，不部署 | 云端多用户 App Server 会话隔离在实际发布阶段重新评审 |

## 3. 目标架构

```text
WebUI
  ├─ OpenAI 登录页 / 账户状态
  ├─ 产品、历史、确认、产物预览
  └─ HTTP + SSE
        ↓
Production Controller + Runtime Core
  ├─ 阶段、确认、恢复、终态
  ├─ SQLite 事件与产物血缘
  └─ ToolGateway / Evidence / ManualAuthority
        ↓
Codex App Server Adapter（stdio JSON-RPC）
  ├─ account/read、account/login/start、account/logout
  ├─ thread/start、thread/resume
  ├─ turn/start、turn/steer、turn/interrupt
  ├─ Item / Delta / Turn 事件映射
  └─ Dynamic Tool 请求回送 ToolGateway
        ↓
Codex
  ├─ 文档与代码生产
  ├─ 图片素材工位
  ├─ 音频素材 Adapter
  └─ 3D 素材 Adapter
```

## 4. 关键边界

- WebUI 不直接持有 OpenAI Token，也不直接调用模型 API。
- App Server 进程只由服务端启动，路径通过 `CODEX_BINARY` 配置，默认 `codex`。
- 一个产品项目对应可恢复的 Codex Thread；一个生产批次对应 Turn。
- App Server 通知先映射为现有 `AgentRuntimeEvent`，从而保留历史 UI、SSE 和 SQLite 兼容性。
- Codex 请求动态工具时，仍必须经过现有 ToolGateway 的 schema、工作区、P0–P3 权限和审计裁决。
- Codex 的“完成”只表示 Turn 结束；进入下一阶段仍需确定性结果检查、Evidence 和人工确认。
- 三份原始手册在每个新产品流程开始时逐字节校验、完整读取并锁定本地私有持久快照；同一流程的所有工位、返工、重试以及 Worker 重启恢复都复用该未压缩快照，不重新读取磁盘原文；流程完成或终止后删除快照正文，只保留关闭标记并禁止再次读取；快照不进入公开仓库或产品数据库备份，下一个新产品才重新读取。

## 5. 本轮不做

- 不执行 veFaaS 或其他真实发布。
- 不为音频或 3D 绑定未经确认的付费供应商。
- 不删除历史 SQLite 数据和旧协议事件。
- 不把 Codex TUI、品牌或 Rust 代码复制进本项目。
- 不把历史验收文档改写成当前事实；旧文档保留作为迁移前证据。

## 6. 验收口径

1. 未登录 OpenAI 时，只能进入登录页和认证 API。
2. 登录页能发起 Codex 官方 ChatGPT 登录，并在成功后进入工厂。
3. Worker 通过 App Server 创建/恢复 Thread，启动 Turn，并流式产生真实事件。
4. 中断和引导命令映射到 `turn/interrupt` 与 `turn/steer`。
5. 仓库与运行配置中不再存在 Pi Agent/DeepSeek 生产依赖或 Key 要求。
6. 图片、音频、3D 工位进入蓝图；缺少音频/3D工具时明确阻塞而不是伪造产物。
7. Lint、TypeScript、单元测试、构建、Playwright、真实浏览器和三手册校验全部通过。
