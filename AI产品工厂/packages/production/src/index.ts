import { randomUUID } from "node:crypto";
import { RuleBasedBlueprintCompiler, type BlueprintCompiler } from "@factory/blueprints";
import { SqliteProjectRegistry, type ProjectRegistry } from "@factory/records";
import {
  projectCreateInputSchema,
  type ProductProject,
  type ProjectCreateInput,
  type ProjectSummary
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
