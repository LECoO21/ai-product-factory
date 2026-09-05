import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FileText } from "lucide-react";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { hasConfirmableAgentResult } from "@factory/shared";
import { StartRunButton } from "@/components/start-run-button";
import { RetryRunButton } from "@/components/retry-run-button";
import { DeleteProjectButton } from "@/components/delete-project-button";
import { getProjectPrimaryActionLabel, runStatusLabels, stageLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProductFactory().getProject(id);
  if (!project) notFound();
  const runStore = new SqliteProductionRunStore();
  const recentRuns = runStore.listForProject(project.id);
  const latestRun = recentRuns[0];
  const latestRunEvents = latestRun ? runStore.events(latestRun.id) : [];
  const latestRunNeedsApproval = latestRun
    ? hasConfirmableAgentResult(latestRunEvents) &&
      (latestRun.stage === "intake" || latestRun.stage === "adaptation") &&
      (latestRun.status === "waiting_approval" || latestRun.status === "succeeded") &&
      !latestRunEvents.some((event) => event.type === "gate.approved")
    : false;
  const latestRunHasEmptyResult = latestRun
    ? (latestRun.status === "waiting_approval" || latestRun.status === "succeeded") &&
      !hasConfirmableAgentResult(latestRunEvents)
    : false;
  const productFlowCompleted = project.status === "candidate" || project.status === "released" ||
    recentRuns.some((run) => runStore.events(run.id).some((event) =>
      event.type === "gate.approved" && event.payload.completed === true
    ));

  return (
    <div className="page simple-page">
      <header className="simple-project-header">
        <Link href="/" className="back-link"><ArrowLeft aria-hidden="true" />返回产品列表</Link>
        <div className="project-title-block">
          <span>产品档案</span>
          <h1>{project.name}</h1>
        </div>
        <div className="project-header-actions">
          {latestRunHasEmptyResult && latestRun ? (
            <RetryRunButton runId={latestRun.id} />
          ) : latestRun ? (
            <Link href={`/runs/${latestRun.id}`} className="primary-button">
              {getProjectPrimaryActionLabel(latestRun, latestRunNeedsApproval, productFlowCompleted)}
              <ArrowUpRight aria-hidden="true" />
            </Link>
          ) : (
            <StartRunButton projectId={project.id} />
          )}
          <DeleteProjectButton projectId={project.id} projectName={project.name} />
        </div>
      </header>

      {recentRuns.length > 0 ? (
        <section className="simple-run-list">
          {recentRuns.slice(0, 20).map((run) => (
            <Link href={`/runs/${run.id}`} key={run.id}>
              <strong>{stageLabels[run.stage]}</strong>
              <span>
                {(run.status === "waiting_approval" || run.status === "succeeded") &&
                !hasConfirmableAgentResult(runStore.events(run.id))
                  ? "结果为空"
                  : runStatusLabels[run.status]}
              </span>
            </Link>
          ))}
        </section>
      ) : null}

      <details className="prd-details">
        <summary><FileText aria-hidden="true" />查看 PRD</summary>
        <pre className="prd-text">{project.prd}</pre>
      </details>
    </div>
  );
}
