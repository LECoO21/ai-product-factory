import { NextResponse } from "next/server";
import { createProductionController } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";
import { finalizeProductFlowResources } from "@/lib/product-flow-lifecycle.server";

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    try {
      const result = createProductionController(new SqliteProductionRunStore()).approveAndContinue(id);
      if (!result.nextRun) finalizeProductFlowResources(result.completedRun.projectId);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return apiError(
        "RUN_APPROVAL_NOT_ALLOWED",
        error instanceof Error ? error.message : "无法进入下一步",
        400
      );
    }
  });
}
