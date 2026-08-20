import { describe, expect, it } from "vitest";
import { RuleBasedBlueprintCompiler } from "./index";

const compiler = new RuleBasedBlueprintCompiler();

describe("RuleBasedBlueprintCompiler", () => {
  it("composes game capabilities without leaking them into the core schema", () => {
    const blueprint = compiler.compile(
      "做一个可以在手机浏览器玩的小游戏。玩家点击躲避障碍，记录得分，刷新后可以重新开始。"
    );

    expect(blueprint.capabilityPacks).toContain("web-interface");
    expect(blueprint.capabilityPacks).toContain("game-experience");
    expect(blueprint.capabilityPacks).not.toContain("agent-runtime");
    expect(JSON.stringify(blueprint)).not.toContain('"level"');
    expect(
      blueprint.stages.find((stage) => stage.id === "real-acceptance")?.requiredChecks
    ).toContain("real-playtest");
  });

  it("builds a non-game agent blueprint without game checks", () => {
    const blueprint = compiler.compile(
      "面向运营团队的 Web 内容工作台，调用大模型批量生成文章，任务在后台运行，需要登录和发布前确认。"
    );

    expect(blueprint.capabilityPacks).toEqual(
      expect.arrayContaining([
        "web-interface",
        "agent-runtime",
        "long-running-task",
        "accounts-and-tenancy",
        "high-risk-actions"
      ])
    );
    expect(blueprint.capabilityPacks).not.toContain("game-experience");
    expect(
      blueprint.stages.find((stage) => stage.id === "real-acceptance")?.requiredChecks
    ).not.toContain("real-playtest");
  });
});
