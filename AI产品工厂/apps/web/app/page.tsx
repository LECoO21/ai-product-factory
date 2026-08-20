import Link from "next/link";
import { getProductFactory } from "@factory/production";
import { SqliteProductionRunStore } from "@factory/records";
import { ProjectCard } from "@/components/project-card";
import { formatDate, runStatusLabels } from "@/lib/labels";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = getProductFactory().listProjects();
  const runStore = new SqliteProductionRunStore();
  const runs = projects
    .flatMap((project) =>
      runStore.listForProject(project.id).map((run) => ({
        run,
        project
      }))
    )
    .sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
  const focusRun = runs.find(({ run }) => run.status === "running" || run.status === "ready") ?? runs[0];
  const focusEvents = focusRun ? runStore.events(focusRun.run.id) : [];
  const activeRuns = runs.filter(({ run }) => run.status === "running" || run.status === "ready").length;
  const blockedRuns = runs.filter(({ run }) => run.status === "blocked").length;
  const capabilityCount = new Set(projects.flatMap((project) => project.blueprint.capabilityPacks)).size;

  return (
    <div className="page dashboard-page">
      <header className="dashboard-hero">
        <div className="dashboard-hero-copy">
          <span className="eyebrow">从 PRD 到发布候选</span>
          <h1>
            每个产品，
            <br />
            <span>都走可控生产线。</span>
          </h1>
          <p>
            工厂先理解产品，再组合蓝图、能力包与质量闸门。确定性控制器负责状态，大模型只在授权工位内生产。
          </p>
          <div className="hero-actions">
            <Link href="/projects/new" className="primary-button">
              导入新 PRD
            </Link>
            <a href="#factory-floor" className="secondary-button">
              查看生产现场
            </a>
          </div>
        </div>
        <div className="factory-signal" aria-label="本地工厂状态">
          <div className="signal-orbit" aria-hidden="true">
            <span />
            <i />
            <b />
          </div>
          <div>
            <span className="signal-label">LOCAL FACTORY</span>
            <strong>控制平面在线</strong>
            <small>状态、事件与蓝图由本地 SQLite 持久化</small>
          </div>
        </div>
      </header>

      <section className="dashboard-metrics" aria-label="工厂概况">
        <article>
          <span>产品项目</span>
          <strong>{String(projects.length).padStart(2, "0")}</strong>
          <small>不同产品，共用工厂内核</small>
        </article>
        <article>
          <span>活动批次</span>
          <strong>{String(activeRuns).padStart(2, "0")}</strong>
          <small>等待领取或正在执行</small>
        </article>
        <article>
          <span>等待处理</span>
          <strong>{String(blockedRuns).padStart(2, "0")}</strong>
          <small>阻塞不会被伪装成成功</small>
        </article>
        <article>
          <span>已用能力包</span>
          <strong>{String(capabilityCount).padStart(2, "0")}</strong>
          <small>按产品画像动态组合</small>
        </article>
      </section>

      <div className="dashboard-grid" id="factory-floor">
        <section className="factory-floor-card" aria-labelledby="factory-floor-title">
          <div className="dashboard-card-head">
            <div>
              <span className="dashboard-kicker">FACTORY FLOOR</span>
              <h2 id="factory-floor-title">生产现场</h2>
            </div>
            <span className="live-badge">
              <i /> 实时档案
            </span>
          </div>

          {focusRun ? (
            <article className={`focus-run focus-run-${focusRun.run.status}`}>
              <div className="focus-run-topline">
                <span className="run-project-name">{focusRun.project.name}</span>
                <span className={`run-status run-status-${focusRun.run.status}`}>
                  {runStatusLabels[focusRun.run.status]}
                </span>
              </div>
              <h3>{focusRun.run.objective}</h3>
              <p>
                {focusRun.run.error ??
                  "批次状态与 Agent 事件会先写入生产档案；刷新页面后仍可从真实状态恢复。"}
              </p>
              <dl className="focus-run-meta">
                <div>
                  <dt>事件</dt>
                  <dd>{focusEvents.length} 条</dd>
                </div>
                <div>
                  <dt>Worker</dt>
                  <dd>{focusRun.run.workerId ? "已领取" : "等待领取"}</dd>
                </div>
                <div>
                  <dt>更新</dt>
                  <dd>{formatDate(focusRun.run.updatedAt)}</dd>
                </div>
              </dl>
              <Link href={`/runs/${focusRun.run.id}`} className="inline-action">
                进入批次驾驶舱 <span aria-hidden="true">→</span>
              </Link>
            </article>
          ) : (
            <div className="factory-empty">
              <span className="factory-empty-mark" aria-hidden="true" />
              <h3>还没有生产批次</h3>
              <p>先导入一份 PRD，工厂会生成产品画像与生产蓝图，再由你决定是否启动。</p>
              <Link href="/projects/new" className="inline-action">
                创建第一个项目 <span aria-hidden="true">→</span>
              </Link>
            </div>
          )}

          {runs.length > 1 ? (
            <div className="recent-runs">
              <span>最近批次</span>
              {runs.slice(1, 4).map(({ run, project }) => (
                <Link href={`/runs/${run.id}`} key={run.id}>
                  <span>{project.name}</span>
                  <strong>{runStatusLabels[run.status]}</strong>
                </Link>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="manual-card" id="manuals" aria-labelledby="manual-title">
          <div className="manual-card-head">
            <span className="manual-index">3/3</span>
            <span>工程宪章</span>
          </div>
          <h2 id="manual-title">三份原文，贯穿整条生产线。</h2>
          <p>项目文档只记录适配结论与证据，不能压缩或替代原始手册。</p>
          <ol className="manual-steps">
            <li className="is-current">
              <span>01</span>
              <div>
                <strong>通用技术栈 V2.1</strong>
                <small>PRD → 核心链路与 MVP</small>
              </div>
            </li>
            <li className="is-current">
              <span>02</span>
              <div>
                <strong>通用前端 V1.0</strong>
                <small>MVP → 正式可交互前端</small>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>上线部署 V1.1</strong>
                <small>验收通过 → veFaaS 上线</small>
              </div>
            </li>
          </ol>
          <div className="manual-proof">
            <span className="proof-dot" />
            本轮原文完整性校验通过
          </div>
        </aside>
      </div>

      <section className="production-map" aria-labelledby="production-map-title">
        <div className="section-head section-head-wide">
          <div>
            <span className="dashboard-kicker">PRODUCTION MAP</span>
            <h2 id="production-map-title">一条由控制器掌舵的路线</h2>
          </div>
          <p>产品差异进入蓝图，生命周期规则留在工厂内核。</p>
        </div>
        <ol className="production-steps">
          <li>
            <span>01</span>
            <strong>接单体检</strong>
            <small>读取 PRD 与三份原始手册</small>
          </li>
          <li>
            <span>02</span>
            <strong>编译蓝图</strong>
            <small>画像、工位、能力包与闸门</small>
          </li>
          <li>
            <span>03</span>
            <strong>Agent 生产</strong>
            <small>Pi Agent + DeepSeek 受控执行</small>
          </li>
          <li>
            <span>04</span>
            <strong>质量验收</strong>
            <small>自动证据与人工确认缺一不可</small>
          </li>
          <li>
            <span>05</span>
            <strong>发布候选</strong>
            <small>通过闸门后才允许进入部署</small>
          </li>
        </ol>
      </section>

      <section id="projects" className="projects-section">
        <div className="section-head">
          <div>
            <span className="dashboard-kicker">PRODUCT PORTFOLIO</span>
            <h2>产品项目</h2>
          </div>
          <p>{projects.length > 0 ? `当前共 ${projects.length} 个真实项目` : "等待第一份 PRD"}</p>
        </div>
        {projects.length > 0 ? (
          <div className="project-grid">
            {projects.map((project, index) => (
              <ProjectCard key={project.id} project={project} index={index} />
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-inner">
              <div className="empty-diagram" aria-hidden="true">
                <span />
                <i />
                <span />
                <i />
                <span />
              </div>
              <h2>生产线已经就绪</h2>
              <p>导入第一份 PRD，工厂会根据真实需求编译生产蓝图，不预设产品类型。</p>
              <Link href="/projects/new" className="primary-button">
                导入第一份 PRD
              </Link>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
