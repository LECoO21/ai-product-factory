# Codex App Server 迁移｜第一阶段开发文档

> 前置决定：`docs/28-Codex-App-Server架构迁移技术适配声明.md` 已由产品负责人本轮明确确认。

## 1. 本阶段目标

用户使用自己的 OpenAI 账户进入产品工厂；产品工厂以 Codex App Server 运行原有生产流程，并能识别图片、音频和 3D 素材工位是否可生产。

## 2. 本阶段包含

- 服务端 App Server JSON-RPC 客户端、初始化、退出和错误归一化。
- `account/read`、ChatGPT `account/login/start`、登录状态刷新、取消登录和 `account/logout`。
- 登录闸门和简化后的登录页面。
- `thread/start/resume`、`turn/start/steer/interrupt` 与流式事件映射。
- Dynamic Tool 到 ToolGateway 的受控桥接。
- 文本/代码、图片、音频、3D 素材工位定义和能力检测。
- 删除 Pi Agent、DeepSeek 依赖、环境变量和当前运行说明。
- 保留 SQLite、SSE、G1–G9、人工确认和“只到发布候选”的边界。
- 三份手册在每个新产品流程开始时完整校验、读取一次并写入本地私有持久快照；流程内所有工位、返工、重试以及 Worker 重启恢复均复用该快照；完成或终止后删除正文、保留关闭标记且不再读取。该快照不进入公开仓库或产品数据库备份；首次读取失败即终止当前流程，需新建产品流程重试。

## 3. 本阶段不包含

- 真实部署或发布。
- 购买、注册或自动选择音频/3D 第三方服务。
- 多用户云端 App Server 资源隔离。
- 对全部历史文档做事实改写。

## 4. 用户流程

1. 打开产品工厂，系统读取 Codex 账户状态。
2. 未登录时点击“使用 OpenAI 账户登录”，在官方页面完成登录。
3. 返回产品工厂，登录状态确认后进入工作台。
4. 输入需求或 PRD，系统沿用已确认阶段流转。
5. Runtime Core 让 Codex 在受控工作区执行当前生产单。
6. 需要素材时进入对应工位：可用则生产并登记 Artifact，不可用则显示所缺能力。
7. 每个确认点继续允许通过、修改、回答问题或取消。

## 5. 状态矩阵

| 模块 | 初始 | 运行 | 等待用户 | 成功 | 失败/恢复 |
| --- | --- | --- | --- | --- | --- |
| OpenAI 登录 | 读取账户 | 打开官方登录页并轮询 | 等待用户完成 OAuth | 显示脱敏账户并进入工厂 | 可重试或取消，不伪装成功 |
| Codex Turn | ready | started / streaming | 工具审批或业务确认 | completed + 真实结果 | failed / interrupted，可从 Thread 恢复 |
| 素材工位 | capability check | producing | 需要付费/外部写入时确认 | Artifact ready | capability_missing / failed，保留上游结果 |

## 6. 接口契约

- `GET /api/auth/account`：返回 `authenticated`、脱敏账户和 App Server 可用性。
- `POST /api/auth/login`：创建 `account.login.start` 命令并返回 `202 + command`；Worker 执行后，命令结果才包含 `loginId` 和官方 `authUrl`。
- `GET /api/auth/commands/:id`：读取持久化命令状态和脱敏结果，用于 Web 轮询。
- `POST /api/auth/login/cancel`：接收 `loginId`，创建取消命令并返回 `202 + command`。
- `POST /api/auth/logout`：创建 App Server 登出命令并返回 `202 + command`。
- App Server：stdio JSONL 请求/响应；初始化完成前不发送业务请求。
- 任何错误统一转换为可恢复的产品文案，不回传 Token、堆栈或原始供应商响应。

## 7. 验收

- 单元测试覆盖 JSON-RPC 配对、账户状态、登录结果、Thread/Turn 映射、Dynamic Tool、媒体能力检测和错误终态。
- 手册快照验收覆盖 Worker 重启后不重读、损坏快照不回退原文、完成后清除正文且关闭标记跨重启生效。
- 现有产品流程测试继续通过。
- 真实运行 `codex app-server` 完成 `initialize` 和脱敏 `account/read` 冒烟。
- 浏览器检查登录页、工作台、运行页以及 390/768/1280/1440px。
- 执行 `npm run lint`、`npm run typecheck`、`npm run test`、`npm run build`、`npm run test:e2e`、`npm run manuals:verify`。

## 8. 风险与回退

- Codex CLI 缺失或版本不兼容：显示“Codex 未安装/不可用”，不回退 DeepSeek。
- 用户未登录：生产批次进入可恢复阻塞态，登录后重试。
- App Server 进程退出：终止未完成请求，保留 SQLite 事件；重启客户端后恢复 Thread。
- 音频/3D 工具缺失：只阻塞对应可选工位，不影响已有文本、代码或图片产物。
