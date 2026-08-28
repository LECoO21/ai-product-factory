// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductionRun, RunEvent } from "@factory/shared";
import { RunConsole } from "./run-console";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/stream/run-stream-client", () => ({ connectRunStream: () => () => undefined }));

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
    expect(screen.getByRole("button", { name: "确认理解，进入技术方案" }).closest(".run-output-panel")).toBeInTheDocument();
    expect(screen.getByText("本阶段不会部署或发布。", { exact: false })).toBeInTheDocument();
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
