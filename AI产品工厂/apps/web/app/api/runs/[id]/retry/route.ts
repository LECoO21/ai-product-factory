import { NextResponse } from "next/server";
import { createProductionController } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    try {
      const run = createProductionController(new SqliteProductionRunStore()).retryWithoutResult(id);
      return NextResponse.json({ run }, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法重新分析" },
        { status: 409 }
      );
    }
  });
}
