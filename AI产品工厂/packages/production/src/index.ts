import { randomUUID } from "node:crypto";
import { RuleBasedBlueprintCompiler, type BlueprintCompiler } from "@factory/blueprints";
import {
  SqliteProjectRegistry,
  type ProductionRunStore,
  type ProjectRegistry
} from "@factory/records";
import {
  projectCreateInputSchema,
  getProductPrototype,
  hasConfirmableAgentResult,
  type ProductProject,
  type ProjectCreateInput,
  type ProjectSummary,
  type ProductionStage
} from "@factory/shared";

export interface ProductFactory {
  createProject(input: ProjectCreateInput): ProductProject;
  getProject(id: string): ProductProject | null;
  listProjects(): ProjectSummary[];
}

export class LocalProductFactory implements ProductFactory {
  constructor(
    private readonly projects: ProjectRegistry,
    private readonly blueprints: BlueprintCompiler
  ) {}

  createProject(input: ProjectCreateInput): ProductProject {
    const validated = projectCreateInputSchema.parse(input);
    const blueprint = this.blueprints.compile(validated.prd);
    const profile = this.blueprints.profile(validated.prd);
    const now = new Date().toISOString();
    const project: ProductProject = {
      id: randomUUID(),
      name: validated.name,
      description: validated.description,
      prd: validated.prd,
      workspacePath: validated.workspacePath,
      status: "draft",
      profile,
      blueprint,
      createdAt: now,
      updatedAt: now
    };

    this.projects.save(project, {
      id: randomUUID(),
      projectId: project.id,
      type: "project.created",
      payload: {
        blueprintId: blueprint.id,
        capabilityPacks: blueprint.capabilityPacks
      },
      occurredAt: now
    });
    return project;
  }

  getProject(id: string) {
    return this.projects.get(id);
  }

  listProjects() {
    return this.projects.list();
  }
}

let singleton: ProductFactory | undefined;

export const getProductFactory = (): ProductFactory => {
  singleton ??= new LocalProductFactory(
    new SqliteProjectRegistry(),
    new RuleBasedBlueprintCompiler()
  );
  return singleton;
};

export const createProductFactory = (
  projects: ProjectRegistry,
  blueprints: BlueprintCompiler = new RuleBasedBlueprintCompiler()
) => new LocalProductFactory(projects, blueprints);

const nextPlanningStage: Partial<
  Record<ProductionStage, { stage: ProductionStage; objective: string }>
> = {
  intake: {
    stage: "adaptation",
    objective: "根据已确认的产品理解生成技术适配声明"
  },
  adaptation: {
    stage: "stage-design",
    objective: "根据已确认的技术方案生成第一阶段开发计划"
  },
  "stage-design": {
    stage: "implementation",
    objective: "根据已确认的开发计划和产品基础稿制作第一版可运行产品"
  },
  implementation: {
    stage: "automated-quality",
    objective: "对已确认的第一版产品执行确定性检查和真实接口冒烟"
  },
  "automated-quality": {
    stage: "real-acceptance",
    objective: "请产品负责人亲自操作第一版产品并确认真实体验"
  },
  "real-acceptance": {
    stage: "release-preparation",
    objective: "根据已确认的产品和验收结果生成发布准备方案，不执行部署"
  }
};

const retryableRunStatuses = new Set(["waiting_approval", "succeeded", "failed", "blocked"]);

export class ProductionController {
  constructor(private readonly runs: ProductionRunStore) {}

  approveAndContinue(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("生产步骤不存在");
    const events = this.runs.events(run.id);
    if (!hasConfirmableAgentResult(events)) {
      throw new Error("AI 结果尚未生成，不能确认");
    }
    if (run.stage === "stage-design" && !getProductPrototype(events)) {
      throw new Error("当前产品基础 HTML 尚未生成，不能进入制作产品");
    }
    if (
      (run.stage === "implementation" || run.stage === "real-acceptance") &&
      !getProductPrototype(events)
    ) {
      throw new Error("当前可运行产品尚未登记，不能进入下一步");
    }
    if (run.stage === "release-preparation") {
      return this.runs.approveAndComplete(run.id);
    }
    const next = nextPlanningStage[run.stage];
    if (!next) throw new Error("当前步骤之后的生产能力尚未开放");
    return this.runs.approveAndCreateNext(run.id, next.objective, next.stage);
  }

  retryWithoutResult(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new Error("生产步骤不存在");
    if (!retryableRunStatuses.has(run.status)) throw new Error("当前批次仍在处理中");
    if (hasConfirmableAgentResult(this.runs.events(run.id))) {
      throw new Error("当前批次已有可确认结果");
    }
    if (run.status === "waiting_approval" || run.status === "succeeded") {
      this.runs.transition(run.id, "failed", "AI 未生成可确认结果");
    }
    return this.runs.create(run.projectId, run.objective, run.stage);
  }
}

export const createProductionController = (runs: ProductionRunStore) =>
  new ProductionController(runs);
