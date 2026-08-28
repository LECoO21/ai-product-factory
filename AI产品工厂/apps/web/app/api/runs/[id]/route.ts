import { NextResponse } from "next/server";
import { SqliteProductionRunStore } from "@factory/records";
import { getHarnessView } from "@/lib/harness-server";
import { apiError } from "@/lib/api/server-error";

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    const store = new SqliteProductionRunStore();
    const run = store.get(id);
    if (!run) return apiError("RUN_NOT_FOUND", "生产批次不存在", 404);
    return NextResponse.json({ run, events: store.events(id), harness: getHarnessView(id) });
  });
}
