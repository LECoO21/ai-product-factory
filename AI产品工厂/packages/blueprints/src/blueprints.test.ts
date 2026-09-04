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
    expect(blueprint.mediaStations).toEqual([]);
    expect(
      blueprint.stages.find((stage) => stage.id === "implementation")?.requiredChecks
    ).not.toContain("model3d-tool-capability");
  });

  it("selects granular media stations while keeping the coarse multimedia pack", () => {
    const blueprint = compiler.compile(
      "做一个游戏，需要生成角色插画和贴图、制作背景音乐与音效，并生产 GLB 格式的 3D 模型。"
    );

    expect(blueprint.capabilityPacks.filter((pack) => pack === "multimedia")).toHaveLength(1);
    expect(blueprint.capabilityPacks).toContain("long-running-task");
    expect(blueprint.mediaStations?.map((station) => station.kind)).toEqual([
      "image",
      "audio",
      "model3d"
    ]);
    expect(compiler.profile("生成图片、配音和三维模型").artifactKinds).toEqual(
      expect.arrayContaining(["image", "audio", "model3d"])
    );

    const implementationChecks = blueprint.stages.find(
      (stage) => stage.id === "implementation"
    )?.requiredChecks;
    const acceptanceChecks = blueprint.stages.find(
      (stage) => stage.id === "real-acceptance"
    )?.requiredChecks;
    expect(implementationChecks).toEqual(expect.arrayContaining([
      "image-tool-capability",
      "audio-decode-check",
      "model3d-parse-check"
    ]));
    expect(acceptanceChecks).toEqual(expect.arrayContaining([
      "image-human-review",
      "audio-playback",
      "model3d-preview"
    ]));
    expect(blueprint.assumptions).toContain(
      "媒体工位只声明所需工具能力；运行时必须验证真实工具可用性，未接入时停止而不是伪造产物。"
    );
  });

  it("does not mistake a language model for a 3D production request", () => {
    const blueprint = compiler.compile("使用大模型分析文本并生成产品需求文档，不生产任何媒体素材。");

    expect(blueprint.mediaStations).toEqual([]);
    expect(blueprint.capabilityPacks).not.toContain("multimedia");
  });
});
