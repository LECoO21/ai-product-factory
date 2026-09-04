import { describe, expect, it } from "vitest";
import { getProjectPrimaryActionLabel } from "./labels";

describe("getProjectPrimaryActionLabel", () => {
  it("never presents a cancelled product flow as continuable", () => {
    expect(getProjectPrimaryActionLabel({ status: "cancelled" }, false))
      .toBe("查看已终止记录");
  });

  it("keeps normal confirmation and continuation labels", () => {
    expect(getProjectPrimaryActionLabel({ status: "waiting_approval" }, true)).toBe("去确认");
    expect(getProjectPrimaryActionLabel({ status: "running" }, false)).toBe("继续");
    expect(getProjectPrimaryActionLabel({ status: "succeeded" }, false, true))
      .toBe("查看完成记录");
  });
});
