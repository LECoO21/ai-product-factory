# ADR 0002：Codex App Server 作为唯一 Agent 运行时

## 状态

已接受，2026-09-02。取代 ADR 0001 中 Pi Agent + DeepSeek 的运行时选择；ADR 0001 对确定性控制平面、受控 Harness 和人工闸门的决定仍然有效。

## 决定

AI 产品工厂通过服务端 stdio JSON-RPC 接入 Codex App Server。用户必须使用自己的 ChatGPT/OpenAI 账户登录。产品项目映射 Codex Thread，生产批次映射 Turn；Codex 的工具请求通过现有 ToolGateway 执行。

图片、音频和 3D 是独立素材工位。Codex 负责编排；具体二进制产物由可审计的 Tool、MCP 或 CLI Adapter 生成。没有真实能力时返回 `capability_missing`。

## 后果

- 删除 Pi Agent、DeepSeek SDK 和模型 Key 配置。
- 增加 App Server 进程生命周期、协议版本兼容和账户登录状态管理。
- 保留 Runtime Core、Production Controller、SQLite、SSE、ManualAuthority、Evidence 和 P0–P3 权限。
- 当前只支持本地优先的单用户形态；正式云部署前必须重新验证每用户会话隔离、凭据存储和 App Server 进程拓扑。

