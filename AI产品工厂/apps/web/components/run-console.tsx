"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  hasConfirmableAgentResult,
  type ProductionRun,
  type ProductionStage,
  type RunEvent
} from "@factory/shared";
import { runStatusLabels } from "@/lib/labels";
import { getEmptyRunPresentation } from "@/lib/run-presentation";
import { RetryRunButton } from "@/components/retry-run-button";

const eventLabels: Record<string, string> = {
  "run.created": "任务已创建",
  "run.claimed": "开始处理",
  "agent.started": "AI 已开始",
  "turn.started": "AI 正在思考",
  "text.delta": "AI 输出",
  "tool.started": "开始执行",
  "tool.completed": "执行完成",
  "agent.completed": "AI 已完成",
  "agent.failed": "AI 处理失败",
  "run.blocked": "等待配置",
  "run.succeeded": "这一步已完成",
  "run.failed": "这一步失败",
  "run.waiting_approval": "等待你的确认",
  "gate.requested": "需要你确认",
  "gate.approved": "你已确认，进入下一步"
};

const simpleStages: Array<{ ids: ProductionStage[]; label: string }> = [
  { ids: ["intake"], label: "理解产品" },
  { ids: ["adaptation"], label: "确定方案" },
  { ids: ["stage-design"], label: "开发计划" },
  { ids: ["implementation"], label: "制作产品" },
  { ids: ["automated-quality", "real-acceptance"], label: "测试验收" },
  { ids: ["release-preparation"], label: "准备发布" }
];

const nextActions: Partial<
  Record<ProductionStage, { title: string; button: string }>
> = {
  intake: {
    title: "请确认 AI 对产品的理解",
    button: "确认理解，进入技术方案"
  },
  adaptation: {
    title: "请确认推荐的技术方案",
    button: "确认方案，生成开发计划"
  }
};

const cleanInline = (text: string) =>
  text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();

function ResultDocument({ output }: { output: string }) {
  return (
    <div className="agent-output result-document">
      {output.split("\n").map((line, index) => {
        const value = line.trim();
        if (!value || /^---+$/.test(value)) return null;
        const heading = value.match(/^#{1,6}\s+(.*)$/);
        if (heading) return <h3 key={index}>{cleanInline(heading[1] ?? "")}</h3>;
        const bullet = value.match(/^[-*]\s+(.*)$/);
        if (bullet) return <p className="result-bullet" key={index}>{cleanInline(bullet[1] ?? "")}</p>;
        return <p key={index}>{cleanInline(value)}</p>;
      })}
    </div>
  );
}

export function RunConsole({ initialRun, initialEvents }: { initialRun: ProductionRun; initialEvents: RunEvent[] }) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(initialEvents);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (run.status !== "ready" && run.status !== "running") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [run.status]);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${run.id}/events`);
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as RunEvent;
      setEvents((current) =>
        current.some((item) => item.sequence === event.sequence) ? current : [...current, event]
      );
      if (event.type.startsWith("run.")) {
        void fetch(`/api/runs/${run.id}`)
          .then((response) => response.json())
          .then((result: { run?: ProductionRun }) => {
            if (result.run) setRun(result.run);
          });
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [run.id]);

  const output = useMemo(
    () => events.filter((event) => event.type === "text.delta").map((event) => String(event.payload.delta ?? "")).join(""),
    [events]
  );
  const visibleEvents = useMemo(
    () =>
      events
        .filter(
          (event, index) =>
            event.type !== "text.delta" || events[index + 1]?.type !== "text.delta"
        )
        .slice(-20),
    [events]
  );
  const currentStageIndex = simpleStages.findIndex((stage) => stage.ids.includes(run.stage));
  const approvedEvent = events.find((event) => event.type === "gate.approved");
  const nextRunId = approvedEvent?.payload.nextRunId;
  const nextAction = nextActions[run.stage];
  const resultIsConfirmable = hasConfirmableAgentResult(events);
  const canApprove =
    Boolean(nextAction) &&
    !approvedEvent &&
    resultIsConfirmable &&
    (run.status === "waiting_approval" || run.status === "succeeded");
  const elapsedSeconds = Math.max(0, Math.floor((clock - Date.parse(run.createdAt)) / 1000));
  const elapsedLabel =
    elapsedSeconds < 60
      ? `${elapsedSeconds} 秒`
      : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
  const emptyPresentation = getEmptyRunPresentation(run, resultIsConfirmable, elapsedLabel);

  async function approve() {
    setApproving(true);
    setApprovalError(null);
    try {
      const response = await fetch(`/api/runs/${run.id}/approve`, { method: "POST" });
      const result = (await response.json()) as { nextRun?: ProductionRun; error?: string };
      if (!response.ok || !result.nextRun) throw new Error(result.error ?? "无法进入下一步");
      router.push(`/runs/${result.nextRun.id}`);
    } catch (error) {
      setApprovalError(error instanceof Error ? error.message : "无法进入下一步");
      setApproving(false);
    }
  }

  return (
    <>
      <section className="simple-progress" aria-label="产品生产进度">
        <div className="simple-progress-compact">
          第 {currentStageIndex + 1} / {simpleStages.length} 步 · {simpleStages[currentStageIndex]?.label}
        </div>
        <ol>
          {simpleStages.map((stage, index) => (
            <li
              className={index < currentStageIndex ? "done" : index === currentStageIndex ? "current" : ""}
              key={stage.label}
            >
              <span>{index < currentStageIndex ? "✓" : index + 1}</span>
              {stage.label}
            </li>
          ))}
        </ol>
      </section>

      {canApprove && nextAction ? (
        <section className="confirmation-card" aria-labelledby="confirmation-title">
          <div>
            <h2 id="confirmation-title">{nextAction.title}</h2>
          </div>
          <div className="confirmation-actions">
            <button className="primary-button" type="button" onClick={approve} disabled={approving}>
              {approving ? "正在进入下一步…" : nextAction.button}
            </button>
            {approvalError ? <p className="form-error">{approvalError}</p> : null}
          </div>
        </section>
      ) : null}

      {typeof nextRunId === "string" ? (
        <section className="confirmation-card confirmation-complete">
          <h2>已确认</h2>
          <button className="primary-button" type="button" onClick={() => router.push(`/runs/${nextRunId}`)}>
            查看下一步
          </button>
        </section>
      ) : null}

      <div className="run-layout run-layout-simple" id="ai-result">
        <section className="panel run-output-panel">
        <div className="run-panel-head">
          <h2>AI 结果</h2>
          <span
            className={`run-status run-status-${emptyPresentation.statusOverride ? "failed" : run.status}`}
          >
            {emptyPresentation.statusOverride ?? runStatusLabels[run.status]}
          </span>
        </div>
        {output ? (
          <ResultDocument output={output} />
        ) : (
          <div className="waiting-output">
            {emptyPresentation.showActivity ? <span className="waiting-pulse" /> : null}
            <p>{emptyPresentation.message}</p>
            {emptyPresentation.canRetry ? <RetryRunButton runId={run.id} /> : null}
          </div>
        )}
        </section>

      </div>

      <details className="run-log-details">
        <summary>运行记录</summary>
        <ol className="event-list">
          {visibleEvents.map((event) => (
            <li key={event.sequence}>
              <span className="event-dot" />
              <div>
                <strong>{eventLabels[event.type] ?? event.type}</strong>
                {event.type === "agent.failed" ? (
                  <p>{String(event.payload.message ?? "执行失败")}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
