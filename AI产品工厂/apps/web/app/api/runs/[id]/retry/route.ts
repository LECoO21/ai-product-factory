import { NextResponse } from "next/server";
import { createProductionController } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { apiError } from "@/lib/api/server-error";

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    try {
      const run = createProductionController(new SqliteProductionRunStore()).retryWithoutResult(id);
      return NextResponse.json({ run }, { status: 201 });
    } catch (error) {
      return apiError(
        "RUN_RETRY_NOT_ALLOWED",
        error instanceof Error ? error.message : "无法重新分析",
        409
      );
    }
  });
}
