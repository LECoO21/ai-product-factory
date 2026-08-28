# G6 最小可执行 Harness 验收报告

> 验收日期：2026-08-26
>
> 当前结论：代码、真实模型闭环、浏览器和自动检查均通过；生产批次已停在人工确认闸门，等待产品负责人确认后再进入下一阶段。

## 一、交付结果

- Pi `Agent` 是唯一 Agent Loop；FactoryHarness 只负责领域状态、完成验证和运行控制，没有自建模型 while-loop。
- DeepSeek 通过合法工具别名调用内部规范工具名；数据库继续记录 `manual.verify` 等规范名。
- ToolGateway 统一执行 schema、P0–P3、路径、幂等和结果登记。
- Agent 消息与工具事件写入 JSONL Session；写入前清除 `undefined`，不再因 durable payload 中断。
- WorkPlan 编号按 Harness Run 隔离，不同生产批次可以重复使用 `wp-1`。
- WebUI 只在真实结果与完成证据齐全后显示确认按钮；失败批次不显示确认按钮。

## 二、真实 DeepSeek 闭环

成功生产批次：`e610088d-7c27-4196-a8ee-81bfee50a506`

成功 Harness Run：`802dd586-5a42-40e3-a353-d7c1abdfb5b6`

真实执行顺序：

1. 校验并加载三份手册；
2. 读取测试工作区；
3. 修改 `math.js`，把正确实现改成错误实现；
4. 运行测试，真实得到 `exitCode=1`；
5. 登记失败测试报告与失败 Evidence；
6. 修复 `math.js`；
7. 再次运行测试，真实得到 `exitCode=0`；
8. 登记通过测试报告、工作区 diff 与通过 Evidence；
9. CompletionVerifier 判定 `completion_goal_satisfied`；
10. 生产控制器进入 `waiting_approval`，此时才允许页面显示确认按钮。

首次失败 Evidence：`0aba9f5d-ada0-42ef-91a7-1738ed575810`

最终通过 Evidence：`d4fa1386-7151-4e04-9b05-180ce657d4c8`

历史失败批次和失败原因均保留，没有删除或覆盖：

- Pi 高层 `AgentHarness.prompt` 未实现；
- DeepSeek 拒绝带点号的模型工具名；
- Session durable payload 含 `undefined`；
- Evidence 的模型工具 schema 未显式描述字段。

这些失败均已转成回归测试或明确适配规则。

## 三、浏览器验收

- 390px、1280px、1440px 均无横向溢出；
- 成功批次显示“首次测试：失败（exitCode 1）”和“修复复测：通过”；
- 成功批次显示“确认 Harness 验证结果”；
- 失败批次不显示确认按钮；
- 最近工具记录、测试产物和 Evidence 可以从运行页查看。

## 四、自动检查

2026-08-26 实际执行并通过：

```text
npm run manuals:verify  PASS（三份手册全部 OK）
npm run lint            PASS
npm run typecheck       PASS
npm run test            PASS（17 files，53 tests）
npm run build           PASS
```

## 五、数据与安全

迁移前备份仍保留：`data/backups/before-0002-1787663710465.sqlite`。

验收后的真实数据库只增加记录，没有减少历史数据：

```text
projects: 4
production_runs: 18
production_events: 4
run_events: 14435
```

三份手册、`.env`、SQLite、`data/` 和 `agent-blueprint/` 均不进入公开提交。

## 六、当前人工闸门

现在只需要产品负责人在成功批次页面检查失败报告、通过报告和运行轨迹，然后点击“确认 Harness 验证结果”。未确认前不进入下一阶段，不执行部署。
