import { describe, expect, it } from "vitest";
import {
  PRODUCT_PROTOTYPE_END,
  PRODUCT_PROTOTYPE_START,
  type RunEvent
} from "@factory/shared";
import { buildChatEntries } from "./run-chat";

const event = (sequence: number, type: string, payload: RunEvent["payload"] = {}): RunEvent => ({
  sequence,
  id: `event-${sequence}`,
  runId: "run-1",
  type,
  payload,
  occurredAt: "2026-09-05T00:00:00.000Z"
});

const delta = (sequence: number, text: string) => event(sequence, "text.delta", { delta: text });

const outputText = (events: readonly RunEvent[]) => buildChatEntries(events)
  .flatMap((entry) => entry.kind === "output" ? [entry.text] : [])
  .join("");

describe("buildChatEntries", () => {
  it("keeps output, an adjustment, and subsequent output in their original conversation order", () => {
    const adjustment = event(3, "harness.command.steer", { message: "请把确认操作放进对话" });
    const tool = event(4, "tool.completed", { summary: "已读取当前方案" });
    const events = Object.freeze([
      delta(1, "原方案"),
      delta(2, "已生成。"),
      adjustment,
      tool,
      delta(5, "按你的修改意见，"),
      delta(6, "确认操作会进入对话。")
    ]);

    expect(buildChatEntries(events)).toEqual([
      { kind: "output", key: "event-1", text: "原方案已生成。" },
      { kind: "user", key: "event-3", event: adjustment },
      { kind: "activity", key: "event-4", events: [tool] },
      { kind: "output", key: "event-5", text: "按你的修改意见，确认操作会进入对话。" }
    ]);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(events[0]?.payload.delta).toBe("原方案");
  });

  it.each(["gate.approved", "gate.revision_requested", "harness.command.abort"])(
    "retains %s as an explicit user message between outputs",
    (type) => {
      const action = event(2, type, { feedback: "保留这次操作记录", nextStage: "adaptation" });

      expect(buildChatEntries([delta(1, "已有结果"), action, delta(3, "后续结果")])).toEqual([
        { kind: "output", key: "event-1", text: "已有结果" },
        { kind: "user", key: "event-2", event: action },
        { kind: "output", key: "event-3", text: "后续结果" }
      ]);
    }
  );

  it("does not render protocol mirrors as duplicate output or duplicate activity", () => {
    const tool = event(5, "tool.completed", { summary: "已完成检查" });
    const events = [
      delta(1, "方案"),
      event(2, "protocol.item.delta", { payload: { legacyType: "text.delta", delta: "方案" } }),
      delta(3, "已完成"),
      event(4, "protocol.item.delta", { payload: { legacyType: "text.delta", delta: "已完成" } }),
      tool,
      event(6, "protocol.item.completed", { payload: { legacyType: "tool.completed", summary: "已完成检查" } })
    ];

    expect(buildChatEntries(events)).toEqual([
      { kind: "output", key: "event-1", text: "方案已完成" },
      { kind: "activity", key: "event-5", events: [tool] }
    ]);
  });

  it("retains all 25 activity records instead of truncating to the most recent 20", () => {
    const activities = Array.from({ length: 25 }, (_, index) =>
      event(index + 1, "tool.completed", { summary: `执行记录 ${index + 1}` })
    );

    expect(buildChatEntries(activities)).toEqual([
      { kind: "activity", key: "event-1", events: activities }
    ]);
  });

  it("removes prototype HTML when both markers and the HTML arrive across chunks", () => {
    const events = [
      delta(1, `开发计划\n${PRODUCT_PROTOTYPE_START.slice(0, 12)}`),
      delta(2, `${PRODUCT_PROTOTYPE_START.slice(12)}\n<!doctype html><html>`),
      event(3, "tool.completed", { summary: "基础稿已保存" }),
      delta(4, `<body>不能显示的源代码</body></html>\n${PRODUCT_PROTOTYPE_END.slice(0, 15)}`),
      delta(5, `${PRODUCT_PROTOTYPE_END.slice(15)}\n请确认基础稿。`)
    ];

    expect(outputText(events)).toBe("开发计划\n\n请确认基础稿。");
    expect(buildChatEntries(events).map(({ kind }) => kind)).toEqual(["output", "activity", "output"]);
    expect(JSON.stringify(buildChatEntries(events))).not.toContain("不能显示的源代码");
  });

  it("withholds an incomplete streaming marker and restores following text when the block closes", () => {
    const events = [delta(1, `开发计划\n${PRODUCT_PROTOTYPE_START.slice(0, -4)}`)];

    expect(outputText(events)).toBe("开发计划\n");
    expect(outputText([
      ...events,
      delta(2, `${PRODUCT_PROTOTYPE_START.slice(-4)}<html>源代码</html>${PRODUCT_PROTOTYPE_END}基础稿已保存`)
    ])).toBe("开发计划\n基础稿已保存");
  });

  it.each(["agent.completed", "agent.failed", "run.cancelled", "run.waiting_approval"])(
    "restores a legitimate trailing less-than symbol on %s without duplicating it",
    (terminalType) => {
      const text = delta(1, "比较运算符：<");
      const terminal = event(2, terminalType);
      const persisted = event(3, "run.succeeded");

      expect(outputText([text])).toBe("比较运算符：");
      expect(buildChatEntries([text, terminal, persisted])).toEqual([
        { kind: "output", key: "event-1", text: "比较运算符：<" },
        { kind: "activity", key: "event-2", events: [terminal, persisted] }
      ]);
      expect(text.payload.delta).toBe("比较运算符：<");
    }
  );

  it.each(["agent.failed", "run.cancelled"])(
    "keeps unfinished HTML and an incomplete end marker hidden after %s",
    (terminalType) => {
      const terminal = event(3, terminalType, { message: "生成已停止" });
      const events = [
        delta(1, `已生成的开发计划\n${PRODUCT_PROTOTYPE_START}<html>`),
        delta(2, `<body>不能显示的源代码</body>${PRODUCT_PROTOTYPE_END.slice(0, 15)}`),
        terminal
      ];

      expect(buildChatEntries(events)).toEqual([
        { kind: "output", key: "event-1", text: "已生成的开发计划\n" },
        { kind: "activity", key: "event-3", events: [terminal] }
      ]);
      expect(outputText(events)).not.toContain("源代码");
      expect(outputText(events)).not.toContain("<!--");
    }
  );

  it("keeps an unfinished prototype block out of the visible stream while retaining user controls", () => {
    const stop = event(3, "harness.command.abort", {});
    const events = [
      delta(1, `开发计划${PRODUCT_PROTOTYPE_START}<html>`),
      delta(2, "<body>仍在生成的源代码"),
      stop
    ];

    expect(buildChatEntries(events)).toEqual([
      { kind: "output", key: "event-1", text: "开发计划" },
      { kind: "user", key: "event-3", event: stop }
    ]);
  });
});
