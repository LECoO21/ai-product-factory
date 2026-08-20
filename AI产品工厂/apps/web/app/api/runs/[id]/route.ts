import { NextResponse } from "next/server";
import { SqliteProductionRunStore } from "@factory/records";

export function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    const store = new SqliteProductionRunStore();
    const run = store.get(id);
    if (!run) return NextResponse.json({ error: "生产批次不存在" }, { status: 404 });
    return NextResponse.json({ run, events: store.events(id) });
  });
}
