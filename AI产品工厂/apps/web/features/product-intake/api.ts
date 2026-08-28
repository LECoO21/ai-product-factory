import { productProjectSchema, type ProjectCreateInput } from "@factory/shared";
import { z } from "zod";
import { requestJson } from "@/lib/api/client";

const createProjectResponseSchema = z.object({ project: productProjectSchema });

export function createProject(input: ProjectCreateInput) {
  return requestJson("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
    schema: createProjectResponseSchema
  });
}
