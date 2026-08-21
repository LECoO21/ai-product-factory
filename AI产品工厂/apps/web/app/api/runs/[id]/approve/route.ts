import { NextResponse } from "next/server";
import { createProductionController } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";

export function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    try {
      const result = createProductionController(new SqliteProductionRunStore()).approveAndContinue(id);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "无法进入下一步" },
        { status: 400 }
      );
    }
  });
}
