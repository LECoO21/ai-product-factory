import Link from "next/link";
import { notFound } from "next/navigation";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { StartRunButton } from "@/components/start-run-button";
import {
  capabilityLabels,
  displayValues,
  formatDate,
  statusLabels,
  valueLabels
} from "@/lib/labels";

export const dynamic = "force-dynamic";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = getProductFactory().getProject(id);
  if (!project) notFound();
  const recentRuns = new SqliteProductionRunStore().listForProject(project.id);

  const profileRows = [
    ["用户任务", displayValues(project.profile.userTasks)],
    ["交互形态", displayValues(project.profile.interactionModes)],
    ["目标终端", displayValues(project.profile.targetSurfaces)],
    ["执行特征", displayValues(project.profile.executionTraits)],
    ["数据特征", displayValues(project.profile.dataTraits)],
    ["AI 角色", valueLabels[project.profile.aiRole] ?? project.profile.aiRole],
    ["部署目标", displayValues(project.profile.deploymentTargets)]
  ];

  return (
    <div className="page">
      <header className="detail-header">
        <Link href="/" className="back-link">
          ← 返回产品项目
        </Link>
        <div className="detail-title">
          <div>
            <span className="eyebrow">产品项目 / {statusLabels[project.status]}</span>
            <h1>{project.name}</h1>
            <p>{project.description || "已完成初始产品画像，等待进一步确认。"}</p>
            <StartRunButton projectId={project.id} />
          </div>
          <div className="detail-meta">
            <span>蓝图 V{project.blueprint.version}</span>
            <span>{formatDate(project.createdAt)}</span>
          </div>
        </div>
      </header>

      <div className="metrics">
        <div className="metric">
          <strong>{project.blueprint.capabilityPacks.length}</strong>
          <span>已触发能力包</span>
        </div>
        <div className="metric">
          <strong>{project.blueprint.stages.length}</strong>
          <span>生产阶段</span>
        </div>
        <div className="metric">
          <strong>{project.profile.evidence.length}</strong>
          <span>画像判断证据</span>
        </div>
      </div>

      <div className="detail-grid">
        <section className="panel">
          <h2>产品画像</h2>
          <dl>
            {profileRows.map(([label, value]) => (
              <div className="profile-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="pack-list">
            {project.blueprint.capabilityPacks.length > 0 ? (
              project.blueprint.capabilityPacks.map((pack) => (
                <span className="pack-pill" key={pack}>
                  {capabilityLabels[pack]}
                </span>
              ))
            ) : (
              <span className="pack-pill">仅使用通用基础工位</span>
            )}
          </div>
        </section>

        <section className="panel">
          <h2>生产蓝图</h2>
          <ol className="timeline">
            {project.blueprint.stages.map((stage, index) => (
              <li className="timeline-item" key={stage.id}>
                <span className="timeline-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="timeline-content">
                  <h3>{stage.title}</h3>
                  <p>{stage.purpose}</p>
                  <div className="check-count">{stage.requiredChecks.length} 项质量证据</div>
                </div>
                <span className="timeline-state">待执行</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="panel prd-panel">
          <h2>原始 PRD</h2>
          <pre className="prd-text">{project.prd}</pre>
        </section>
        {recentRuns.length > 0 ? (
          <section className="panel prd-panel">
            <h2>最近生产批次</h2>
            <div className="run-links">
              {recentRuns.map((run) => (
                <Link href={`/runs/${run.id}`} key={run.id}>
                  <strong>{run.objective}</strong>
                  <span>{run.status}</span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
