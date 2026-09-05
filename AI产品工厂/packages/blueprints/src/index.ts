import { randomUUID } from "node:crypto";
import type {
  BlueprintStage,
  CapabilityPack,
  MediaKind,
  MediaProductionStation,
  ProductProfile,
  ProductionBlueprint
} from "@factory/shared";

export interface BlueprintCompiler {
  compile(prd: string): ProductionBlueprint;
  profile(prd: string): ProductProfile;
}

type SignalRule = {
  pattern: RegExp;
  conclusion: string;
};

const hasSignal = (text: string, rules: SignalRule[]) =>
  rules.find((rule) => rule.pattern.test(text));

const addUnique = (values: string[], value: string) => {
  if (!values.includes(value)) values.push(value);
};

const addPack = (packs: Set<CapabilityPack>, pack: CapabilityPack) => packs.add(pack);

const mediaStationByKind: Record<MediaKind, MediaProductionStation> = {
  image: {
    id: "image-production",
    kind: "image",
    title: "图片素材生产",
    requiredToolCapability: "image-generation",
    requiredChecks: {
      implementation: ["image-tool-capability", "image-artifact-integrity", "image-provenance"],
      acceptance: ["image-preview", "image-human-review"]
    }
  },
  audio: {
    id: "audio-production",
    kind: "audio",
    title: "音频素材生产",
    requiredToolCapability: "audio-generation",
    requiredChecks: {
      implementation: ["audio-tool-capability", "audio-decode-check", "audio-provenance"],
      acceptance: ["audio-playback", "audio-human-review"]
    }
  },
  model3d: {
    id: "model3d-production",
    kind: "model3d",
    title: "3D 素材生产",
    requiredToolCapability: "model3d-generation",
    requiredChecks: {
      implementation: ["model3d-tool-capability", "model3d-parse-check", "model3d-provenance"],
      acceptance: ["model3d-preview", "model3d-human-review"]
    }
  }
};

const mediaSignals: Array<{ kind: MediaKind; rules: SignalRule[] }> = [
  {
    kind: "image",
    rules: [
      {
        pattern: /生成图片|生成图像|制作图片|图片素材|图像素材|插画|海报|图标|纹理|贴图|精灵图|image generation|generate images?|illustration|texture|sprite/,
        conclusion: "需要生产图片素材"
      }
    ]
  },
  {
    kind: "audio",
    rules: [
      {
        pattern: /生成音频|制作音频|音频素材|语音合成|配音|旁白|音效|配乐|背景音乐|\btts\b|audio generation|sound effects?|music generation/,
        conclusion: "需要生产音频素材"
      }
    ]
  },
  {
    kind: "model3d",
    rules: [
      {
        pattern: /\b3d\b|3d模型|3d素材|三维模型|三维素材|三维资产|立体模型|网格模型|\bmesh(?:es)?\b|\bglb\b|\bgltf\b|\bfbx\b/,
        conclusion: "需要生产 3D 素材"
      }
    ]
  }
];

const baseStages: BlueprintStage[] = [
  {
    id: "intake",
    title: "需求分析",
    purpose: "确认输入、约束、冲突和重大缺失。",
    requiredChecks: ["input-traceability", "assumption-disclosure"],
    optional: false
  },
  {
    id: "scope",
    title: "产品范围确认",
    purpose: "冻结当前批次的用户任务、核心闭环和明确不做。",
    requiredChecks: ["product-scope-gate"],
    optional: false
  },
  {
    id: "adaptation",
    title: "技术适配",
    purpose: "选择与真实产品约束相符的技术路线。",
    requiredChecks: ["safety-baseline", "architecture-fit"],
    optional: false
  },
  {
    id: "stage-design",
    title: "阶段设计",
    purpose: "生成当前阶段的契约、状态和可操作验收项。",
    requiredChecks: ["contract-completeness", "scope-control"],
    optional: false
  },
  {
    id: "implementation",
    title: "产品实现",
    purpose: "完成一条真实、可运行的产品闭环。",
    requiredChecks: ["change-safety", "automated-tests"],
    optional: false
  },
  {
    id: "automated-quality",
    title: "自动质量检查",
    purpose: "运行代码、类型、测试和构建检查。",
    requiredChecks: ["lint", "typecheck", "test", "build"],
    optional: false
  },
  {
    id: "real-acceptance",
    title: "真实产品验收",
    purpose: "通过真实操作判断产品闭环与体验。",
    requiredChecks: ["real-user-flow", "human-quality-gate"],
    optional: false
  },
  {
    id: "release-preparation",
    title: "上线方案",
    purpose: "形成目标环境、配置、发布步骤和回退方式。",
    requiredChecks: ["release-candidate", "rollback-plan"],
    optional: false
  },
  {
    id: "release-readiness",
    title: "上线检查",
    purpose: "核对产品、测试、验收、配置和回滚材料。",
    requiredChecks: ["artifact-ready", "quality-evidence", "acceptance-evidence", "rollback-plan"],
    optional: false
  },
  {
    id: "release-handoff",
    title: "待人工发布",
    purpose: "生成可由产品负责人执行的发布与回滚清单，工厂不执行发布。",
    requiredChecks: ["manual-release-checklist", "no-automatic-deployment"],
    optional: false
  }
];

export class RuleBasedBlueprintCompiler implements BlueprintCompiler {
  profile(prd: string): ProductProfile {
    const text = prd.toLowerCase();
    const profile: ProductProfile = {
      userTasks: [],
      interactionModes: [],
      targetSurfaces: [],
      executionTraits: [],
      artifactKinds: [],
      dataTraits: [],
      aiRole: "unknown",
      riskTraits: [],
      qualityModes: ["deterministic-tests"],
      deploymentTargets: [],
      evidence: []
    };

    const record = (dimension: string, signal: string, conclusion: string) => {
      profile.evidence.push({ dimension, signal, conclusion });
    };

    const game = hasSignal(text, [
      { pattern: /小游戏|游戏|玩家|关卡|得分|game|player|level/, conclusion: "存在游戏体验" }
    ]);
    if (game) {
      addUnique(profile.userTasks, "entertainment");
      addUnique(profile.interactionModes, "realtime-interaction");
      addUnique(profile.qualityModes, "playability-review");
      addUnique(profile.executionTraits, "interactive-loop");
      record("quality", game.pattern.source, game.conclusion);
    }

    const web = hasSignal(text, [
      { pattern: /网页|web|浏览器|网站|h5|saas|后台|工作台/, conclusion: "目标终端包含 Web" }
    ]);
    if (web || game) {
      addUnique(profile.targetSurfaces, "web");
      addUnique(profile.qualityModes, "browser-e2e");
      record("surface", web?.pattern.source ?? "game-default", "需要浏览器界面");
    }

    const mobile = hasSignal(text, [
      { pattern: /移动端|手机|iphone|android|触屏|小程序/, conclusion: "包含移动终端" }
    ]);
    if (mobile) {
      addUnique(profile.targetSurfaces, "mobile");
      record("surface", mobile.pattern.source, mobile.conclusion);
    }

    const api = hasSignal(text, [
      { pattern: /\bapi\b|接口服务|开放平台|sdk/, conclusion: "产物包含接口能力" }
    ]);
    if (api) {
      addUnique(profile.targetSurfaces, "api");
      record("surface", api.pattern.source, api.conclusion);
    }

    const agent = hasSignal(text, [
      { pattern: /agent|智能体|大模型|llm|deepseek|对话|生成式/, conclusion: "产品运行时可能调用模型" }
    ]);
    if (agent) {
      profile.aiRole = "core";
      addUnique(profile.interactionModes, /对话|chat/.test(text) ? "conversation" : "ai-assisted-workflow");
      addUnique(profile.qualityModes, "model-quality-review");
      record("ai-role", agent.pattern.source, agent.conclusion);
    } else {
      profile.aiRole = "development-only";
    }

    const longTask = hasSignal(text, [
      { pattern: /长任务|队列|异步|生成视频|生成图片|批量|分钟|后台运行|任务中心/, conclusion: "存在跨请求长任务" }
    ]);
    if (longTask) {
      addUnique(profile.executionTraits, "long-running");
      addUnique(profile.dataTraits, "recoverable-task-state");
      record("execution", longTask.pattern.source, longTask.conclusion);
    }

    const rag = hasSignal(text, [
      { pattern: /rag|知识库|语义检索|向量|文档问答|引用来源/, conclusion: "需要检索增强能力" }
    ]);
    if (rag) {
      addUnique(profile.artifactKinds, "retrieval-result");
      addUnique(profile.qualityModes, "retrieval-evaluation");
      record("capability", rag.pattern.source, rag.conclusion);
    }

    const detectedMediaKinds = mediaSignals.flatMap(({ kind, rules }) => {
      const signal = hasSignal(text, rules);
      if (!signal) return [];
      addUnique(profile.artifactKinds, kind);
      record("artifact", signal.pattern.source, signal.conclusion);
      return [kind];
    });
    const otherMultimedia = hasSignal(text, [
      {
        pattern: /生成视频|视频素材|摄像头|麦克风|video generation|generate videos?/,
        conclusion: "涉及尚未细分工位的多媒体资产"
      }
    ]);
    if (otherMultimedia) {
      addUnique(profile.artifactKinds, "multimedia");
      record("artifact", otherMultimedia.pattern.source, otherMultimedia.conclusion);
    }
    if (detectedMediaKinds.length > 0) {
      addUnique(profile.executionTraits, "long-running");
      addUnique(profile.dataTraits, "recoverable-task-state");
    }

    const accounts = hasSignal(text, [
      { pattern: /登录|账号|用户体系|权限|多租户|团队|组织|会员/, conclusion: "需要身份或数据隔离" }
    ]);
    if (accounts) {
      addUnique(profile.dataTraits, "user-owned-data");
      record("data", accounts.pattern.source, accounts.conclusion);
    }

    const realtime = hasSignal(text, [
      { pattern: /实时协作|多人在线|websocket|直播|双向实时|联机/, conclusion: "需要实时通信" }
    ]);
    if (realtime) {
      addUnique(profile.executionTraits, "realtime-communication");
      record("execution", realtime.pattern.source, realtime.conclusion);
    }

    const highRisk = hasSignal(text, [
      { pattern: /支付|扣费|付费|发布|群发|删除|交易|写回|外部发送/, conclusion: "包含高风险或不可逆动作" }
    ]);
    if (highRisk) {
      addUnique(profile.riskTraits, "approval-required");
      record("risk", highRisk.pattern.source, highRisk.conclusion);
    }

    if (/本地|localhost|离线/.test(text)) addUnique(profile.deploymentTargets, "local");
    if (/上线|公网|部署|云端|域名/.test(text)) addUnique(profile.deploymentTargets, "public-web");
    if (profile.deploymentTargets.length === 0) profile.deploymentTargets.push("undecided");
    if (profile.targetSurfaces.length === 0) profile.targetSurfaces.push("undecided");
    if (profile.userTasks.length === 0) profile.userTasks.push("to-be-refined");
    if (profile.interactionModes.length === 0) profile.interactionModes.push("form-or-workflow");
    if (profile.executionTraits.length === 0) profile.executionTraits.push("request-response");
    if (profile.artifactKinds.length === 0) profile.artifactKinds.push("digital-output");
    if (profile.dataTraits.length === 0) profile.dataTraits.push("to-be-refined");

    return profile;
  }

  compile(prd: string): ProductionBlueprint {
    const profile = this.profile(prd);
    const packs = new Set<CapabilityPack>();

    if (profile.targetSurfaces.includes("web")) addPack(packs, "web-interface");
    if (profile.aiRole === "core" || profile.aiRole === "supporting") addPack(packs, "agent-runtime");
    if (profile.executionTraits.includes("long-running")) addPack(packs, "long-running-task");
    if (profile.qualityModes.includes("retrieval-evaluation")) addPack(packs, "rag");
    const mediaStations = mediaSignals
      .map(({ kind }) => kind)
      .filter((kind) => profile.artifactKinds.includes(kind))
      .map((kind) => mediaStationByKind[kind]);
    if (profile.artifactKinds.includes("multimedia") || mediaStations.length > 0) {
      addPack(packs, "multimedia");
    }
    if (profile.qualityModes.includes("playability-review")) addPack(packs, "game-experience");
    if (profile.dataTraits.includes("user-owned-data")) addPack(packs, "accounts-and-tenancy");
    if (profile.riskTraits.includes("approval-required")) addPack(packs, "high-risk-actions");
    if (profile.executionTraits.includes("realtime-communication")) addPack(packs, "realtime-communication");

    const stages = baseStages.map((stage) => ({
      ...stage,
      requiredChecks: [...stage.requiredChecks]
    }));
    const implementation = stages.find((stage) => stage.id === "implementation");
    const acceptance = stages.find((stage) => stage.id === "real-acceptance");

    if (packs.has("agent-runtime")) {
      implementation?.requiredChecks.push("prompt-versioning", "structured-output");
      acceptance?.requiredChecks.push("real-model-smoke", "model-quality-review");
    }
    if (packs.has("game-experience")) {
      implementation?.requiredChecks.push("game-state-reset", "input-loop");
      acceptance?.requiredChecks.push("real-playtest", "playability-review");
    }
    if (packs.has("web-interface")) acceptance?.requiredChecks.push("browser-e2e", "responsive-check");
    if (packs.has("rag")) acceptance?.requiredChecks.push("retrieval-evaluation", "citation-check");
    if (packs.has("high-risk-actions")) acceptance?.requiredChecks.push("human-impact-confirmation");
    for (const station of mediaStations) {
      station.requiredChecks.implementation.forEach((check) =>
        addUnique(implementation?.requiredChecks ?? [], check)
      );
      station.requiredChecks.acceptance.forEach((check) =>
        addUnique(acceptance?.requiredChecks ?? [], check)
      );
    }

    return {
      id: randomUUID(),
      version: 1,
      capabilityPacks: [...packs],
      mediaStations,
      stages,
      assumptions: [
        "产品画像由确定性规则生成，进入生产前需要 Agent 校正和用户确认。",
        ...(mediaStations.length > 0
          ? ["媒体工位只声明所需工具能力；运行时必须验证真实工具可用性，未接入时停止而不是伪造产物。"]
          : [])
      ],
      unsupportedCapabilities: [],
      generatedAt: new Date().toISOString()
    };
  }
}
