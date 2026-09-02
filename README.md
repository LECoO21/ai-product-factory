# AI 产品工厂

一个本地优先、可控制、可观察、可恢复的 AI 数字产品生产流水线。用户登录自己的 ChatGPT/OpenAI 账户，由 Codex App Server 在受控 Harness 内把不同类型数字产品从 PRD 生产到发布候选。工厂内核不绑定任何产品类型，小游戏只是第一台试产样机。

## 这是什么

- **对话式 Web 控制台**：首页输入需求或粘贴 PRD，系统自动创建产品、锁定本次流程的三手册快照并立即开始分析。
- **确定性 Runtime Core**：负责 Thread/Turn 生命周期、状态与人工/质量闸门；Codex App Server 是唯一 Agent 执行引擎。
- **可恢复流水线**：每个阶段结果可确认、可补充、可修改后重新生成；所有生产事件写入 SQLite，刷新、断线、失败后都能恢复。
- **真实素材工位**：图片、音频、3D 分别建模，由 Codex 规划并调用真实工具；未配置的能力如实阻塞，不生成假素材。

## 项目结构

```text
AI产品工厂/
├── apps/
│   ├── web/            # Next.js 控制台（WebUI、API、SSE 实时事件流）
│   └── worker/         # 生产 Worker（领取批次、执行 Codex、写回事件）
├── packages/           # 领域内核与能力包
│   ├── protocol/       # 运行协议事件
│   ├── runtime-core/   # 确定性运行核心
│   ├── agent-runtime/  # Codex App Server 客户端与运行适配器
│   ├── harness/        # Harness、工具网关、完成校验
│   ├── blueprints/     # 蓝图编译与能力包
│   ├── production/     # 生产工作流
│   ├── records/        # SQLite 档案与迁移
│   └── shared/         # 共享类型与素材能力
└── docs/               # 项目文档与历史基线
```

## 快速开始

环境要求：Node.js 22 或更高版本，以及本机可用的 Codex CLI。

```bash
cd AI产品工厂
npm install
cp .env.example .env
npm run dev
```

终端会显示实际访问地址，默认是 `http://localhost:3000`。用户从 Web 登录页发起 ChatGPT/OpenAI 登录，不需要向产品工厂填写模型 API Key；只有 Codex 不在 `PATH` 中时才需在 `.env` 修改 `CODEX_BINARY`。

完整的使用流程、当前状态和工程检查见 [AI产品工厂/README.md](./AI产品工厂/README.md)。

## 最高工程规范

项目必须完整遵循三份内部原始手册，项目内的摘要和派生文档不能替代原文。原始手册仅保留在内部工作区，不随公开仓库分发。内部维护者在具备三份原文的工作区中，应先运行 `npm run manuals:verify`。

## 工程检查

```bash
npm run manuals:verify
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build:vefaas
```

本地数据保存在 `data/factory.sqlite`，该目录已加入 `.gitignore`。
