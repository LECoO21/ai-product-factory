import Link from "next/link";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { ProjectCard } from "@/components/project-card";
import { runStatusLabels, stageLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = getProductFactory().listProjects();
  const runStore = new SqliteProductionRunStore();
  const runs = projects
    .flatMap((project) =>
      runStore.listForProject(project.id).map((run) => ({ run, project }))
    )
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
  const runsWithAction = runs.map((entry) => ({
    ...entry,
    needsApproval:
      (entry.run.stage === "intake" || entry.run.stage === "adaptation") &&
      (entry.run.status === "waiting_approval" || entry.run.status === "succeeded") &&
      !runStore.events(entry.run.id).some((event) => event.type === "gate.approved")
  }));
  const attentionRun =
    runsWithAction.find(({ needsApproval }) => needsApproval) ??
    runsWithAction.find(({ run }) => run.status === "running" || run.status === "ready");

  return (
    <div className="page simple-page">
      <header className="simple-page-header">
        <h1>我的产品</h1>
        <Link href="/projects/new" className="primary-button">
          新建产品
        </Link>
      </header>

      {attentionRun ? (
        <section className="attention-card">
          <div>
            <span>{attentionRun.needsApproval ? "等你确认" : runStatusLabels[attentionRun.run.status]}</span>
            <h2>{attentionRun.project.name}</h2>
            <strong>{stageLabels[attentionRun.run.stage]}</strong>
          </div>
          <Link href={`/runs/${attentionRun.run.id}`} className="primary-button">
            {attentionRun.needsApproval ? "去确认" : "查看进度"}
          </Link>
        </section>
      ) : null}

      <section id="projects">
        {projects.length > 0 ? (
          <div className="project-grid simple-project-grid">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} />
            ))}
          </div>
        ) : (
          <Link href="/projects/new" className="empty-action">
            新建第一个产品
          </Link>
        )}
      </section>
    </div>
  );
}
