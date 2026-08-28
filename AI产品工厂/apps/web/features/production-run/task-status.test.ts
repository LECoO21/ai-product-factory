import { describe, expect, it } from "vitest";
import { getTaskStatus, getTaskStatusPresentation } from "./task-status";

describe("getTaskStatus", () => {
  it("maps backend facts to user-facing task states", () => {
    expect(getTaskStatus("ready")).toBe("queued");
    expect(getTaskStatus("running", { streamConnected: true })).toBe("streaming");
    expect(getTaskStatus("waiting_approval")).toBe("waiting_user");
    expect(getTaskStatus("blocked")).toBe("waiting_user");
    expect(getTaskStatus("succeeded")).toBe("succeeded");
    expect(getTaskStatus("failed")).toBe("failed");
    expect(getTaskStatus("cancelled")).toBe("cancelled");
  });

  it("shows an interrupted active stream as disconnected", () => {
    expect(getTaskStatus("ready", { streamDisconnected: true })).toBe("disconnected");
    expect(getTaskStatus("running", { streamDisconnected: true })).toBe("disconnected");
  });

  it("never guesses when the backend returns an unknown status", () => {
    expect(getTaskStatus("finished_somehow")).toBe("stale");
  });
});

describe("getTaskStatusPresentation", () => {
  it("uses plain user-facing language instead of backend enum names", () => {
    expect(getTaskStatusPresentation("streaming")).toEqual({
      label: "正在制作",
      now: "AI 正在处理这一步，页面会自动更新。",
      action: "现在不用操作，可以继续停留或稍后回来。"
    });
    expect(getTaskStatusPresentation("waiting_user").label).toBe("等你确认");
    expect(getTaskStatusPresentation("disconnected").label).toBe("正在恢复连接");
  });
});
