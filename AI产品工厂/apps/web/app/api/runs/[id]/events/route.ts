import { SqliteProductionRunStore } from "@factory/records";

export const dynamic = "force-dynamic";

const terminal = new Set(["waiting_approval", "blocked", "succeeded", "failed", "cancelled"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  if (!store.get(id)) return new Response("Not found", { status: 404 });
  const encoder = new TextEncoder();
  let lastSequence = Number(new URL(request.url).searchParams.get("after") ?? 0);

  const stream = new ReadableStream({
    async start(controller) {
      const close = () => {
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      request.signal.addEventListener("abort", close, { once: true });
      controller.enqueue(encoder.encode(": connected\n\n"));

      while (!request.signal.aborted) {
        const events = store.events(id, lastSequence);
        for (const event of events) {
          lastSequence = event.sequence;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        const run = store.get(id);
        if (!run || terminal.has(run.status)) {
          close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
