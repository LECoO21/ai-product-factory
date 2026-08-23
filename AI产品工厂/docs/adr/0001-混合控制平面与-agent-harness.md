---
status: accepted
---

# 使用确定性控制平面与 Agent Harness 的混合架构

AI 产品工厂采用确定性生产控制器和 Workflow Runtime 管理状态、权限、预算、检查点与质量闸门，同时由 Pi Agent + DeepSeek 驱动的 Agent Harness 在每个受控目标内规划和调用工具。我们不采用纯固定 Prompt 流水线，因为它只能生成文本，也不采用让模型独占生命周期控制的全自治方案，因为生产状态、安全和验收必须可恢复、可审计并由代码约束。

该方向已经由产品负责人确认；具体产品流程以正式 PRD 为准。
