import Link from "next/link";
import { notFound } from "next/navigation";
import { SqliteProductionRunStore } from "@factory/records";
import { getProductFactory } from "@factory/production";
import { RunConsole } from "@/components/run-console";
import { stageLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = new SqliteProductionRunStore();
  const run = store.get(id);
  if (!run) notFound();
  const project = getProductFactory().getProject(run.projectId);
  if (!project) notFound();

  return (
    <div className="page">
      <header className="detail-header run-header">
        <Link href={`/projects/${project.id}`} className="back-link">
          ← 返回 {project.name}
        </Link>
        <h1>{stageLabels[run.stage]}</h1>
      </header>
      <RunConsole initialRun={run} initialEvents={store.events(run.id)} />
    </div>
  );
}
