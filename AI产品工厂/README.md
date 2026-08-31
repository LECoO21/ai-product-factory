# AI 产品工厂

> 版本：V0.5，G2–G9 流程保留，运行底座已迁入 Codex 式 Protocol + Runtime Core 架构
> 当前定位：供产品负责人本人使用的本地优先对话式 Web 控制台，以 Pi Agent + DeepSeek 为驾驶者，以受控 Agent Harness 为执行载具，把不同类型数字产品从 PRD 生产到发布候选。

这里的“AI 产品工厂”指由 AI 驱动生产，不要求被生产的产品本身一定包含 AI。小游戏只是第一台试产样机，不是工厂的默认产品类型。

## 最高工程规范

本项目所有分析、开发、前端、测试与部署，必须先完整读取并遵循内部工作区中的三份原始手册。原始手册是唯一权威全文，不随公开仓库分发；项目内文档不得以摘要、压缩或改写替代。执行协议和逐字节完整性校验见 [三份手册执行宪章](./docs/00-三份手册执行宪章.md)。

## 当前方向

- 产品形态：可控制、可观察、可暂停和恢复的 WebUI，不是命令行脚本或一次性 Prompt。
- 核心架构：借鉴 OpenAI Codex 的协议/Core/客户端分离方式；确定性 Runtime Core 管 Thread/Turn 生命周期、状态和闸门，工厂 Agent 在边界内规划并调用工具。
- 协议层：产品项目映射 Thread、生产批次映射 Turn；版本化 `protocol.*` 事件进入 SQLite，旧 WebUI 事件在迁移期兼容双写。
- Agent 运行时：`@earendil-works/pi-agent-core@0.84.2` 的低层 `Agent`，并封装在工厂自己的 `AgentRuntime` / `FactoryHarness` 接口之后；高层 `AgentHarness` 当前为未实现壳，不作为生产入口。
- 模型层：通过 `@earendil-works/pi-ai@0.84.2` 接入 DeepSeek，密钥只保存在服务端环境中。
- 第一版用户：产品负责人本人，暂不处理多租户、团队权限和商业化账户体系。
- 通用性：工厂内核不包含游戏、SaaS 或 Agent 产品的专属概念；产品差异由生产蓝图和能力包表达。
- 第一条试产线：小游戏产品；待小游戏 PRD 提供后接入，用它验证第一条真实生产路线。
- 开发方式：先按五步 SOP 生成需求事实、Harness 五要素、组件选型和七层架构，经确认后再生成代码；确定性 Workflow 管阶段，Agent Loop 管阶段内动作。

## 文档导航

1. [三份手册执行宪章](./docs/00-三份手册执行宪章.md)
2. [领域语言](./CONTEXT.md)
3. [产品定义](./docs/01-产品定义.md)
4. [总体架构](./docs/02-总体架构.md)
5. [工位协议与质量闸门](./docs/03-工位协议与质量闸门.md)
6. [MVP 实施计划](./docs/04-MVP实施计划.md)
7. [小游戏试产接入模板](./docs/05-小游戏试产接入模板.md)
8. [通用产品适配框架](./docs/06-通用产品适配框架.md)
9. [前端技术适配声明](./docs/07-前端技术适配声明.md)
10. [生产驾驶舱阶段开发文档](./docs/08-第一阶段前端开发文档-生产驾驶舱.md)
11. [Naxe 视觉设计规范](./docs/09-视觉设计规范-Naxe.md)
12. [Naxe 对话式产品工作台](./docs/10-小云雀式工作台架构-Naxe.md)
13. [Agent Harness 方向调整与技术适配声明](./docs/11-Agent-Harness方向调整与技术适配声明.md)
14. [AI 产品工厂产品需求文档 PRD](./docs/12-AI产品工厂-产品需求文档-PRD.md)
15. [AI 产品工厂技术适配声明](./docs/13-AI产品工厂-技术适配声明.md)
16. [Harness 五要素领域骨架](./docs/14-AI产品工厂-Harness五要素领域骨架.md)
17. [Agent Blueprint 组件选型表](./docs/15-AI产品工厂-Agent-Blueprint组件选型表.md)
18. [七层架构与产品生产蓝图](./docs/16-AI产品工厂-七层架构与产品生产蓝图.md)
19. [第一阶段技术开发文档：最小可执行 Harness](./docs/17-第一阶段技术开发文档-最小可执行Harness.md)
20. [第一阶段生产单：最小可执行 Harness](./docs/18-第一阶段生产单-最小可执行Harness.md)
21. [第一阶段完成目标：最小可执行 Harness](./docs/19-第一阶段完成目标-最小可执行Harness.md)
22. [G6 最小可执行 Harness 验收报告](./docs/20-G6最小可执行Harness-验收报告.md)
23. [G7 第二阶段前端开发文档：真实任务工作台](./docs/21-G7第二阶段前端开发文档-真实任务工作台.md)
24. [G7 真实任务工作台验收报告](./docs/22-G7真实任务工作台-验收报告.md)
25. [上线技术适配声明](./docs/23-AI产品工厂-上线技术适配声明.md)
26. [G8–G9 上线部署阶段开发文档](./docs/24-G8-G9上线部署阶段开发文档.md)
27. [G8–G9 上线准备验收报告](./docs/25-G8-G9上线准备验收报告.md)
28. [G9 上线流程实现与验收](./docs/26-G9上线流程实现与验收.md)
29. [Codex 式运行架构技术适配与迁移说明](./docs/27-Codex式运行架构技术适配与迁移说明.md)
30. [Codex 式运行架构全景 HTML](./docs/naxe-factory-codex-product-architecture.html)

## 一句话流程

```text
说出需求或导入 PRD
→ 需求拆解与 Harness 领域建模
→ 组件选型与七层架构方案
→ 用户确认方案
→ Workflow 启动，Agent 调用工具生产
→ Goal Gate 检查真实证据
→ 用户验收 Agent 效果
→ 生成上线方案
→ 检查上线材料
→ 生成手工发布清单
→ 停在待人工发布
```

## 当前状态

里程碑 1 已完成；里程碑 2 的执行基础已完成；规划阶段的人工确认链路已打通：

- Next.js Web 控制台；
- 新建产品项目并导入 PRD；
- 从 PRD 生成初始产品画像；
- 根据画像组合能力包并编译生产蓝图；
- 使用 SQLite 保存项目、蓝图和创建事件；
- 项目列表与项目详情页；
- 游戏和非游戏画像的通用性测试；
- `AgentRuntime` 接口、Pi Agent 适配器与内存测试适配器；
- DeepSeek 模型配置、Worker 领取生产批次和 SQLite 事件持久化；
- WebUI 启动“PRD 体检”、运行控制台和 SSE 实时事件流；
- 精简 WebUI：首页只保留待处理任务、产品列表和新建入口；
- 运行页只保留当前步骤、AI 结果、确认按钮和默认收起的最近 20 条运行记录；
- 前端统一 API、错误、任务状态和 SSE 断线恢复；结果与产物优先，工具详情默认折叠；
- Vitest + React Testing Library 覆盖核心交互，Playwright 使用隔离数据库覆盖刷新、失败、断线、键盘和四档宽度；
- “理解产品 → 确认 → 确定技术方案 → 确认 → 生成开发计划”的确定性流转；
- 确认状态、确认事件和下一工位全部持久化，重复确认不会创建重复任务；
- 首页可识别新旧批次的待确认状态，并提供真实“去确认”入口；
- 缺少 `DEEPSEEK_API_KEY` 时如实进入阻塞状态，刷新后仍能恢复完整事件；
- 390px、768px、1280px、1440px 均无横向溢出。

当前画像仍由确定性规则生成，目的是保证没有模型 Key 时工厂也能完成接单和蓝图编译。2026-08-21 已使用本地安全配置完成一次真实 Pi Agent + `deepseek-v4-flash` 端到端冒烟，生产批次成功并持久化完整事件。

G6 最小可执行 Harness 已完成真实 DeepSeek 闭环：受控读取与补丁、测试失败、Evidence 登记、修复、复测通过、完成验证和人工确认时机均已验证。完整 Workflow journal/checkpoint、P2 决定后原地恢复、完整 Goal Gate、用量预算和正式产品生产仍属于后续阶段。

G7 真实任务工作台已验收。G8 已按第三份上线部署手册完成登录保护、Web + Worker 同进程运行、SQLite/TOS 备份接口、结构化日志、Sentry 接口和 veFaaS Linux/Node 20 私有部署包。本地 production standalone、真实浏览器和全部自动检查已通过，状态为“发布候选已就绪”。

G9 已按新方向改为“上线流程”：真实验收后依次生成上线方案、自动核对产品/测试/验收/回滚证据、生成手工发布清单，最后只把产品标记为“发布候选”。流程不登录云平台、不创建资源、不写入正式 Secret、不执行 Git push 或部署。

V0.5 已完成 Codex 式运行底座的第一阶段迁移：新增 `@factory/protocol` 和 `@factory/runtime-core`，Worker 通过注册 Handler 执行工位，Runtime Core 统一检查真实结果并应用终态；Web 的引导/中断命令通过统一 Command Gateway；DeepSeek 通过可替换的 Pi Agent Provider Adapter 接入。现有 G1–G9、三手册、ToolGateway、SQLite、SSE 和前端操作保持兼容。

## 本地运行

环境要求：Node.js 22 或更高版本。

```bash
npm install
cp .env.example .env
npm run dev
```

终端会显示实际访问地址，默认是 `http://localhost:3000`；端口被占用时 Next.js 会自动选择其他端口。

首次使用时，打开项目根目录的 `.env`，把 DeepSeek 开放平台生成的 Key 填到 `DEEPSEEK_API_KEY=` 后面。Worker 会在启动时自动读取该文件；`.env` 已被 Git 忽略，不会上传到公开仓库。`DEEPSEEK_MODEL` 默认使用 `deepseek-v4-flash`。

不配置 `DEEPSEEK_API_KEY` 也可以创建项目、编译蓝图和验证阻塞恢复；只有真实 Agent 推理需要该密钥。修改 `.env` 后需重启 Worker 才会生效。

使用顺序：输入需求或 PRD → 发送后自动开始分析 → 查看 AI 结果 → 直接确认进入下一步，或填写补充回答/修改意见后重新生成当前阶段结果。

## 工程检查

```bash
npm run manuals:verify
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build:vefaas
```

本地数据保存在 `data/factory.sqlite`，该目录已经加入 `.gitignore`。

## veFaaS 发布候选

本节只记录发布候选的构建与人工交接信息，产品工厂不会自动调用 veFaaS 发布命令。

部署构建：

```bash
npm ci
npm run build:vefaas
```

构建产物位于 `apps/web/.next/standalone`，启动命令为 `node apps/web/server.js`，端口为 `3000`。部署时必须显式指定 Node 20 runtime、构建命令、产物路径、启动命令和端口，不使用 CLI 的自动推断结果。

正式环境变量键见 [`.env.example`](./.env.example)。`AUTH_SECRET`、`INVITE_CODES`、`DEEPSEEK_API_KEY`、对象存储凭据和 `SENTRY_DSN` 只能保存在部署平台 Secret 中，不得写入 Git、部署命令或文档。
