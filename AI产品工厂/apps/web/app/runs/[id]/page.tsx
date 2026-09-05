import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Layers3 } from "lucide-react";
import { SqliteProductionRunStore } from "@factory/records";
import { getProductFactory } from "@factory/production";
import { RunConsole } from "@/components/run-console";
import { stageLabels } from "@/lib/labels";
import { getHarnessView } from "@/lib/harness-server";
import { getConversationHistory } from "@/lib/run-conversation-server";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  const run = store.get(id);
  if (!run) notFound();
  const project = getProductFactory().getProject(run.projectId);
  if (!project) notFound();
  const initialEvents = store.events(run.id);
  const history = getConversationHistory(store, { run, events: initialEvents });

  return (
    <div className="page run-page">
      <header className="detail-header run-header">
        <Link href={`/projects/${project.id}`} className="back-link">
          <ArrowLeft aria-hidden="true" />
          <span>返回产品</span>
        </Link>
        <div className="run-title-block">
          <span className="run-stage-kicker">当前阶段 · {stageLabels[run.stage]}</span>
          <h1>{project.name}</h1>
        </div>
        <span className="workspace-mode"><Layers3 aria-hidden="true" />生产工作台</span>
      </header>
      <RunConsole
        key={run.id}
        initialRun={run}
        initialEvents={initialEvents}
        initialHarness={getHarnessView(run.id)}
        projectPrd={project.prd}
        history={history}
      />
    </div>
  );
}
