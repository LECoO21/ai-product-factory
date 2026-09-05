// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionRun, RunEvent } from "@factory/shared";
import { RunConsole } from "./run-console";

const { push, refresh, approveProductionRun, getProductionRun, reviseProductionRun, steerProductionRun } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  approveProductionRun: vi.fn(),
  getProductionRun: vi.fn(),
  reviseProductionRun: vi.fn(),
  steerProductionRun: vi.fn()
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/stream/run-stream-client", () => ({ connectRunStream: () => () => undefined }));
vi.mock("@/features/production-run/api", () => ({
  abortProductionRun: vi.fn(),
  approveProductionRun,
  getProductionRun,
  reviseProductionRun,
  steerProductionRun
}));

const run = (status: ProductionRun["status"], stage: ProductionRun["stage"] = "intake"): ProductionRun => ({
  id: "run-1",
  projectId: "project-1",
  stage,
  objective: "验证产品",
  status,
  workerId: null,
  error: status === "failed" ? "测试没有通过" : null,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:01:00.000Z"
});

const event = (sequence: number, type: string, payload: Record<string, unknown> = {}): RunEvent => ({
  sequence,
  id: `event-${sequence}`,
  runId: "run-1",
  type,
  payload,
  occurredAt: "2026-08-26T00:00:00.000Z"
});

const completedEvents = [
  event(1, "text.delta", { delta: "这是一份已经完成并且可以由产品负责人认真检查确认的产品理解结果。" }),
  event(2, "agent.completed")
];

describe("RunConsole", () => {
  afterEach(cleanup);

  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    approveProductionRun.mockReset();
    getProductionRun.mockReset();
    reviseProductionRun.mockReset();
    steerProductionRun.mockReset();
  });

  it("shows confirmation only after a real result exists", () => {
    const firstRender = render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={[]} initialHarness={null} />
    );
    expect(screen.queryByRole("button", { name: "确认理解，进入技术方案" })).not.toBeInTheDocument();
    firstRender.unmount();

    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );
    const confirmation = screen.getByRole("button", { name: "确认理解，进入技术方案" });
    expect(within(screen.getByRole("main", { name: "对话记录" })).getByRole("button", {
      name: "确认理解，进入技术方案"
    })).toBe(confirmation);
    expect(confirmation.closest(".chat-confirmation")).toBeInTheDocument();
    expect(screen.getByText("本阶段不会部署或发布。", { exact: false })).toBeInTheDocument();
  });

  it("offers corrective feedback after failed quality but never an approval", async () => {
    const user = userEvent.setup();
    reviseProductionRun.mockResolvedValue({ run: { ...run("ready", "implementation"), id: "fixed-run" } });
    render(<RunConsole initialRun={run("failed", "automated-quality")} initialHarness={null}
      initialEvents={[event(1, "text.delta", { delta: "自动检查结果：脚本错误，检查没有通过。" }), event(2, "quality.completed", { passed: false })]} />);
    expect(screen.getByRole("button", { name: "仅重新检查" })).toBeVisible();
    expect(screen.queryByText("等待验收")).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "补充回答或修改意见" }), "修复脚本错误");
    await user.click(screen.getByRole("button", { name: "提交并重新分析" }));
    expect(reviseProductionRun).toHaveBeenCalledWith("run-1", "修复脚本错误");
    expect(push).toHaveBeenCalledWith("/runs/fixed-run");
  });

  it("shows rejected controls in the conversation and permits another stop", () => {
    render(<RunConsole initialRun={run("running")} initialHarness={null} initialEvents={[
      event(1, "harness.command.abort", { reason: "停止" }),
      event(2, "harness.command.receipt", { commandSequence: 1, accepted: false, message: "指令发送失败，请重试" })
    ]} />);
    expect(screen.getByRole("alert")).toHaveTextContent("指令未执行");
    expect(screen.getByRole("button", { name: "终止流程" })).toBeEnabled();
  });

  it("allows the product owner to answer questions or request changes before approval", async () => {
    const user = userEvent.setup();
    reviseProductionRun.mockResolvedValue({ run: { ...run("ready"), id: "run-2" } });
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );

    const feedback = screen.getByRole("textbox", { name: "补充回答或修改意见" });
    expect(feedback.closest(".chat-composer")).toBeInTheDocument();
    await user.type(feedback, "需要支持搜索、打开、复制和整理，验收标准是三步内打开网址。");
    await user.click(screen.getByRole("button", { name: "提交并重新分析" }));

    await waitFor(() => expect(reviseProductionRun).toHaveBeenCalledWith(
      "run-1",
      "需要支持搜索、打开、复制和整理，验收标准是三步内打开网址。"
    ));
    expect(push).toHaveBeenCalledWith("/runs/run-2");
  });

  it("does not confirm partial output before the agent completes", () => {
    render(
      <RunConsole
        initialRun={run("running")}
        initialEvents={[completedEvents[0]!]}
        initialHarness={null}
      />
    );

    expect(screen.getByText("这是一份已经完成并且可以由产品负责人认真检查确认的产品理解结果。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认理解，进入技术方案" })).not.toBeInTheDocument();
  });

  it("executes the real approval action inside the conversation", async () => {
    const user = userEvent.setup();
    approveProductionRun.mockResolvedValue({
      completedRun: run("succeeded"),
      nextRun: { ...run("ready", "adaptation"), id: "run-2" }
    });
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );

    const conversation = screen.getByRole("main", { name: "对话记录" });
    await user.click(within(conversation).getByRole("button", { name: "确认理解，进入技术方案" }));

    await waitFor(() => expect(approveProductionRun).toHaveBeenCalledWith("run-1"));
    expect(push).toHaveBeenCalledWith("/runs/run-2");
  });

  it("retains feedback and shows the failure in the conversation when sending fails", async () => {
    const user = userEvent.setup();
    reviseProductionRun.mockRejectedValue(new Error("暂时无法保存修改，请重试"));
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );
    const feedback = screen.getByRole("textbox", { name: "补充回答或修改意见" });
    await user.type(feedback, "保留历史结果用于对比");
    await user.click(screen.getByRole("button", { name: "提交并重新分析" }));

    expect(await screen.findByText("暂时无法保存修改，请重试")).toBeInTheDocument();
    expect(feedback).toHaveValue("保留历史结果用于对比");
    expect(screen.getByRole("button", { name: "提交并重新分析" })).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
  });

  it("sends a running-stage adjustment from the composer and shows its saved message", async () => {
    const user = userEvent.setup();
    const instruction = "先保留历史版本，再继续生成技术方案。";
    steerProductionRun.mockResolvedValue({ receipt: { accepted: true, commandSequence: 3 } });
    getProductionRun.mockResolvedValue({
      run: run("running"),
      events: [
        completedEvents[0]!,
        event(3, "harness.command.steer", { message: instruction })
      ],
      harness: null
    });
    render(
      <RunConsole initialRun={run("running")} initialEvents={[completedEvents[0]!]} initialHarness={null} />
    );
    const input = screen.getByRole("textbox", { name: "补充要求或调整指令" });
    await user.type(input, instruction);
    await user.click(screen.getByRole("button", { name: "发送" }));

    await waitFor(() => expect(steerProductionRun).toHaveBeenCalledWith("run-1", instruction, expect.any(String)));
    const conversation = screen.getByRole("main", { name: "对话记录" });
    expect((await within(conversation).findByText(instruction)).closest(".chat-message-user")).toBeInTheDocument();
    expect(input).toHaveValue("");
    expect(push).not.toHaveBeenCalled();
  });

  it("sends feedback with Enter", async () => {
    const user = userEvent.setup();
    reviseProductionRun.mockResolvedValue({ run: { ...run("ready"), id: "run-2" } });
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );
    const input = screen.getByRole("textbox", { name: "补充回答或修改意见" });

    await user.type(input, "请保留全部方案记录");
    await user.keyboard("{Enter}");

    await waitFor(() => expect(reviseProductionRun).toHaveBeenCalledWith("run-1", "请保留全部方案记录"));
    expect(reviseProductionRun).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/runs/run-2");
  });

  it("inserts a newline with Shift+Enter without submitting feedback", async () => {
    const user = userEvent.setup();
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );
    const input = screen.getByRole("textbox", { name: "补充回答或修改意见" });

    await user.type(input, "保留历史版本");
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    await user.type(input, "支持前后对比");

    expect(input).toHaveValue("保留历史版本\n支持前后对比");
    expect(reviseProductionRun).not.toHaveBeenCalled();
    expect(steerProductionRun).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "提交并重新分析" })).toBeEnabled();
  });

  it.each([
    { name: "active composition", isComposing: true, keyCode: 13 },
    { name: "IME key code", isComposing: false, keyCode: 229 }
  ])("does not send on an Enter used for $name", async ({ isComposing, keyCode }) => {
    const user = userEvent.setup();
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={completedEvents} initialHarness={null} />
    );
    const input = screen.getByRole("textbox", { name: "补充回答或修改意见" });
    await user.type(input, "还在输入中文补充意见");

    fireEvent.keyDown(input, { key: "Enter", code: "Enter", isComposing, keyCode });
    fireEvent.keyUp(input, { key: "Enter", code: "Enter", isComposing, keyCode });

    expect(input).toHaveValue("还在输入中文补充意见");
    expect(reviseProductionRun).not.toHaveBeenCalled();
    expect(steerProductionRun).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("refreshes the terminal approval into a saved user message without another confirmation", async () => {
    const user = userEvent.setup();
    const completedRun = run("succeeded", "release-handoff");
    const savedEvents = [
      ...completedEvents,
      event(3, "gate.approved", { completed: true, deploymentStarted: false })
    ];
    approveProductionRun.mockResolvedValue({ completedRun, nextRun: null });
    getProductionRun.mockResolvedValue({ run: completedRun, events: savedEvents, harness: null });
    render(
      <RunConsole
        initialRun={run("waiting_approval", "release-handoff")}
        initialEvents={completedEvents}
        initialHarness={null}
      />
    );

    await user.click(screen.getByRole("button", { name: "确认交接，标记为发布候选" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(getProductionRun).toHaveBeenCalledWith("run-1");
    const conversation = screen.getByRole("main", { name: "对话记录" });
    expect(within(conversation).getByText("确认交接，标记为发布候选").closest(".chat-message-user")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "发布候选已生成" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认交接，标记为发布候选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("recovers a terminal confirmation from refreshed same-run props after snapshot fetching fails", async () => {
    const user = userEvent.setup();
    const completedRun = { ...run("succeeded", "release-handoff"), updatedAt: "2026-08-26T00:02:00.000Z" };
    approveProductionRun.mockResolvedValue({ completedRun, nextRun: null });
    getProductionRun.mockRejectedValue(new Error("连接暂时中断"));
    const view = render(
      <RunConsole
        initialRun={run("waiting_approval", "release-handoff")}
        initialEvents={completedEvents}
        initialHarness={null}
      />
    );

    await user.click(screen.getByRole("button", { name: "确认交接，标记为发布候选" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("alert")).toHaveTextContent("已确认，记录暂未同步，请刷新页面查看。");
    expect(screen.queryByRole("button", { name: "确认交接，标记为发布候选" })).not.toBeInTheDocument();

    view.rerender(
      <RunConsole
        initialRun={completedRun}
        initialEvents={[
          ...completedEvents,
          event(3, "gate.approved", { completed: true, deploymentStarted: false })
        ]}
        initialHarness={null}
      />
    );

    const conversation = screen.getByRole("main", { name: "对话记录" });
    const confirmation = within(conversation).getByText("确认交接，标记为发布候选");
    expect(confirmation.closest(".chat-message-user")).toBeInTheDocument();
    expect(within(conversation).getAllByText("确认交接，标记为发布候选")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "发布候选已生成" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认交接，标记为发布候选" })).not.toBeInTheDocument();
    expect(approveProductionRun).toHaveBeenCalledTimes(1);
  });

  it("reveals saved plan steps and distinguishes failed tool executions in the conversation", async () => {
    const user = userEvent.setup();
    render(
      <RunConsole
        initialRun={run("failed")}
        initialEvents={[
          ...completedEvents,
          event(3, "plan.updated", {
            explanation: "先核对已有需求，再生成可以确认的方案。",
            plan: [
              { step: "检查现有项目", status: "completed" },
              { step: "生成技术方案", status: "in_progress" },
              { step: "等待产品确认", status: "pending" }
            ]
          }),
          event(4, "tool.completed", { toolName: "verify_requirements", status: "failed", summary: "缺少目标用户说明" }),
          event(5, "tool.completed", { toolName: "check_artifacts", success: false, summary: "产物尚未准备完成" }),
          event(6, "tool.completed", { toolName: "save_revision", status: "succeeded", summary: "已保存当前方案" }),
          event(7, "run.failed", { error: "验收条件仍未满足" })
        ]}
        initialHarness={null}
      />
    );
    const conversation = screen.getByRole("main", { name: "对话记录" });
    const summary = within(conversation).getByText(/查看运行记录/);
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);

    expect(within(conversation).getByText("先核对已有需求，再生成可以确认的方案。")).toBeVisible();
    expect(within(conversation).getByText("检查现有项目 · 已完成")).toBeVisible();
    expect(within(conversation).getByText("生成技术方案 · 进行中")).toBeVisible();
    expect(within(conversation).getByText("等待产品确认 · 待处理")).toBeVisible();
    for (const toolName of ["verify_requirements", "check_artifacts"]) {
      const record = within(conversation).getByText(toolName).closest("li")!;
      expect(within(record).getByText("执行失败")).toBeVisible();
      expect(within(record).queryByText("执行完成")).not.toBeInTheDocument();
    }
    const successfulRecord = within(conversation).getByText("save_revision").closest("li")!;
    expect(within(successfulRecord).getByText("执行完成")).toBeVisible();
    expect(within(successfulRecord).getByText("已保存当前方案")).toBeVisible();
    expect(within(conversation).getByText("原因：验收条件仍未满足")).toBeVisible();
  });

  it("shows the original requirement, previous results, feedback and approval in chronological conversation order", () => {
    const requirement = "为单人产品负责人整理需求，并保存每一版方案和确认记录。";
    const firstResult = "第一版结果：支持整理需求，待补充历史保存规则。";
    const feedback = "请保存历史版本，允许查看前后变化。";
    const revisedResult = "修改后的结果：每次调整均保存独立版本，可以回看。";
    const nextResult = "技术方案：沿用现有数据库持久保存所有对话记录。";
    render(
      <RunConsole
        projectPrd={requirement}
        history={[
          {
            run: { ...run("cancelled"), id: "run-original" },
            events: [
              event(1, "text.delta", { delta: firstResult }),
              event(2, "agent.completed"),
              event(3, "gate.revision_requested", { feedback, revisionRunId: "run-revised", revisionStage: "intake" })
            ],
            harness: null
          },
          {
            run: { ...run("succeeded"), id: "run-revised" },
            events: [
              event(4, "text.delta", { delta: revisedResult }),
              event(5, "agent.completed"),
              event(6, "gate.approved", { nextRunId: "run-1", nextStage: "adaptation" })
            ],
            harness: null
          }
        ]}
        initialRun={run("waiting_approval", "adaptation")}
        initialEvents={[event(7, "text.delta", { delta: nextResult }), event(8, "agent.completed")]}
        initialHarness={null}
      />
    );

    const conversation = screen.getByRole("main", { name: "对话记录" });
    const transcript = conversation.textContent ?? "";
    const messages = [requirement, firstResult, feedback, revisedResult, "确认理解，进入技术方案", nextResult];
    for (let index = 0; index < messages.length - 1; index += 1) {
      expect(transcript.indexOf(messages[index]!)).toBeGreaterThanOrEqual(0);
      expect(transcript.indexOf(messages[index]!)).toBeLessThan(transcript.indexOf(messages[index + 1]!));
    }
    expect(within(conversation).getByText(requirement).closest(".chat-message-user")).toBeInTheDocument();
    expect(within(conversation).getByText(feedback).closest(".chat-message-user")).toBeInTheDocument();
    expect(within(conversation).getByText(firstResult).closest(".chat-message-assistant")).toBeInTheDocument();
    expect(within(conversation).queryByRole("button", { name: "确认理解，进入技术方案" })).not.toBeInTheDocument();
    expect(within(conversation).getByRole("button", { name: "确认方案，生成开发计划" })).toBeInTheDocument();
  });

  it("simplifies a historical workflow title without modifying saved events, body text or the user request", () => {
    const originalTitle = "PRD 接单体检 | 产品理解摘要";
    const userRequest = `请查看 ${originalTitle} 的历史记录。`;
    const originalBody = `流程原文：${originalTitle}。`;
    const historicalEvents = [
      event(1, "text.delta", { delta: `# **${originalTitle}**\n\n${originalBody}\n\n这是一份已经完成的历史需求分析结果。` }),
      event(2, "agent.completed"),
      event(3, "gate.approved", { nextRunId: "run-1", nextStage: "adaptation" })
    ];
    const storedEvents = JSON.stringify(historicalEvents);
    render(
      <RunConsole
        projectPrd={userRequest}
        history={[{ run: { ...run("succeeded"), id: "run-history" }, events: historicalEvents, harness: null }]}
        initialRun={run("waiting_approval", "adaptation")}
        initialEvents={[event(4, "text.delta", { delta: "# 技术方案\n\n继续根据已确认的产品需求生成技术方案和开发计划。" }), event(5, "agent.completed")]}
        initialHarness={null}
      />
    );

    const conversation = screen.getByRole("main", { name: "对话记录" });
    expect(within(conversation).getByRole("heading", { name: "需求分析" })).toBeInTheDocument();
    expect(within(conversation).queryByRole("heading", { name: originalTitle })).not.toBeInTheDocument();
    expect(within(conversation).getByText(originalBody)).toBeInTheDocument();
    expect(within(conversation).getByText(userRequest).closest(".chat-message-user")).toBeInTheDocument();
    expect(JSON.stringify(historicalEvents)).toBe(storedEvents);
    expect(historicalEvents[0]!.payload.delta).toContain(originalTitle);
  });

  it("preserves real medical headings and body text in an agent result", () => {
    const output = [
      "# 体检预约",
      "用户可以预约医院体检并查看体检报告。",
      "## 医疗体检流程",
      "接单与资料体检是业务原文，不应自动改名。"
    ].join("\n\n");
    const initialEvents = [event(1, "text.delta", { delta: output }), event(2, "agent.completed")];
    render(
      <RunConsole initialRun={run("waiting_approval")} initialEvents={initialEvents} initialHarness={null} />
    );

    const conversation = screen.getByRole("main", { name: "对话记录" });
    expect(within(conversation).getByRole("heading", { name: "体检预约" })).toBeInTheDocument();
    expect(within(conversation).getByRole("heading", { name: "医疗体检流程" })).toBeInTheDocument();
    expect(within(conversation).getByText("用户可以预约医院体检并查看体检报告。")).toBeInTheDocument();
    expect(within(conversation).getByText("接单与资料体检是业务原文，不应自动改名。")).toBeInTheDocument();
    expect(initialEvents[0]!.payload.delta).toBe(output);
  });

  it("hydrates the waiting clock without a server/client text mismatch", async () => {
    const createdAt = Date.parse("2026-08-26T00:00:00.000Z");
    const now = vi.spyOn(Date, "now")
      .mockReturnValueOnce(createdAt)
      .mockReturnValue(createdAt + 1_100);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const props = { initialRun: run("ready"), initialEvents: [], initialHarness: null };
    const container = document.createElement("div");
    container.innerHTML = renderToString(<RunConsole {...props} />);
    document.body.append(container);

    const root = hydrateRoot(container, <RunConsole {...props} />);
    await act(async () => undefined);

    expect(consoleError.mock.calls.flat().join("\n")).not.toContain("Hydration failed");
    await act(async () => root.unmount());
    consoleError.mockRestore();
    now.mockRestore();
  });

  it("does not offer confirmation for a failed run", () => {
    render(
      <RunConsole
        initialRun={run("failed")}
        initialEvents={[...completedEvents, event(3, "agent.failed", { message: "测试没有通过" })]}
        initialHarness={null}
      />
    );

    expect(screen.getAllByText("处理失败").length).toBeGreaterThan(0);
    expect(screen.queryByText("确认理解，进入技术方案")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新分析" })).toBeInTheDocument();
  });

  it("treats explicit cancellation as a terminal product flow without retry", () => {
    render(
      <RunConsole initialRun={run("cancelled")} initialEvents={[]} initialHarness={null} />
    );

    expect(screen.getAllByText("产品流程已终止", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "重新分析" })).not.toBeInTheDocument();
  });

  it("puts artifacts before collapsed execution details", () => {
    render(
      <RunConsole
        initialRun={run("succeeded", "implementation")}
        initialEvents={[...completedEvents, event(3, "harness.completed")]}
        initialHarness={{
          id: "harness-1",
          objective: "验证产品可以运行",
          status: "succeeded",
          stopReason: null,
          plan: [],
          tools: [],
          artifacts: [{ id: "artifact-1", kind: "verification-report", sha256: "hash", size: 2048, status: "ready" }],
          evidence: []
        }}
      />
    );

    expect(screen.getByRole("link", { name: "查看验证报告" })).toBeInTheDocument();
    expect(screen.getByText("查看执行详情").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByText("succeeded")).not.toBeInTheDocument();
  });

  it("ends the release flow as a candidate without claiming publication", () => {
    const firstRender = render(
      <RunConsole
        initialRun={run("waiting_approval", "release-handoff")}
        initialEvents={completedEvents}
        initialHarness={null}
      />
    );
    expect(screen.getByRole("button", { name: "确认交接，标记为发布候选" })).toBeInTheDocument();
    expect(screen.getByText("产品尚未上线", { exact: false })).toBeInTheDocument();
    firstRender.unmount();

    render(
      <RunConsole
        initialRun={run("succeeded", "release-handoff")}
        initialEvents={[
          ...completedEvents,
          event(3, "gate.approved", { completed: true, deploymentStarted: false })
        ]}
        initialHarness={null}
      />
    );
    expect(screen.getByText("发布候选已生成")).toBeInTheDocument();
    expect(screen.getByText("没有执行部署", { exact: false })).toBeInTheDocument();
  });
});
