"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getProductPrototype,
  hasConfirmableAgentResult,
  stripProductPrototype,
  type ProductionRun,
  type ProductionStage,
  type RunEvent
} from "@factory/shared";
import {
  abortProductionRun,
  approveProductionRun,
  getProductionRun,
  steerProductionRun
} from "@/features/production-run/api";
import {
  getTaskStatus,
  getTaskStatusPresentation,
  type TaskStatus
} from "@/features/production-run/task-status";
import { getErrorMessage } from "@/lib/api/client";
import {
  getEmptyRunPresentation,
  getHarnessTestEvidence,
  getStageReviewGuidance
} from "@/lib/run-presentation";
import { connectRunStream } from "@/lib/stream/run-stream-client";
import { mergeRunEvents } from "@/lib/stream/run-stream";
import { RetryRunButton } from "@/components/retry-run-button";
import type { HarnessView } from "@/lib/harness-types";

const eventLabels: Record<string, string> = {
  "run.created": "任务已创建",
  "run.claimed": "开始处理",
  "agent.started": "AI 已开始",
  "turn.started": "AI 正在处理",
  "text.delta": "AI 输出",
  "tool.started": "开始执行",
  "tool.completed": "执行完成",
  "agent.completed": "AI 已完成",
  "agent.failed": "AI 处理失败",
  "run.blocked": "等待配置",
  "run.succeeded": "这一步已完成",
  "run.failed": "这一步失败",
  "run.waiting_approval": "等待你的确认",
  "quality.started": "开始自动检查",
  "quality.completed": "自动检查完成",
  "quality.failed": "自动检查失败",
  "release.readiness.completed": "上线材料检查完成",
  "release.handoff.completed": "手工发布清单已生成",
  "harness.completed": "制作验证完成",
  "harness.command.steer": "已发送调整指令",
  "harness.command.abort": "已请求停止",
  "harness.command.receipt": "运行控制已生效",
  "gate.requested": "需要你确认",
  "gate.approved": "你已确认，进入下一步"
};

const simpleStages: Array<{ ids: ProductionStage[]; label: string }> = [
  { ids: ["intake"], label: "理解产品" },
  { ids: ["adaptation"], label: "确定方案" },
  { ids: ["stage-design"], label: "开发计划" },
  { ids: ["implementation"], label: "验证产品" },
  { ids: ["automated-quality", "real-acceptance"], label: "测试验收" },
  { ids: ["release-preparation"], label: "上线方案" },
  { ids: ["release-readiness"], label: "上线检查" },
  { ids: ["release-handoff"], label: "待人工发布" }
];

const nextActions: Partial<Record<ProductionStage, { title: string; button: string }>> = {
  intake: { title: "请确认 AI 对产品的理解", button: "确认理解，进入技术方案" },
  adaptation: { title: "请确认推荐的技术方案", button: "确认方案，生成开发计划" },
  "stage-design": {
    title: "开发计划和产品基础稿都符合预期吗？",
    button: "确认计划和基础稿，进入制作产品"
  },
  implementation: {
    title: "请先打开制作结果，确认它是要继续检查的产品版本",
    button: "确认制作结果，开始自动检查"
  },
  "automated-quality": {
    title: "自动检查已通过，可以进入真实产品验收",
    button: "确认检查结果，开始真实验收"
  },
  "real-acceptance": {
    title: "请亲自打开产品并完成核心操作",
    button: "我已验收通过，生成上线方案"
  },
  "release-preparation": {
    title: "上线方案已生成，请确认内容和回滚方式",
    button: "确认方案，检查上线材料"
  },
  "release-readiness": {
    title: "上线材料已检查通过",
    button: "确认检查，生成手工发布清单"
  },
  "release-handoff": {
    title: "手工发布清单已生成，但产品尚未上线",
    button: "确认交接，标记为发布候选"
  }
};

const harnessStatusLabels: Record<string, string> = {
  ready: "等待验证",
  running: "正在验证",
  verifying: "正在检查",
  blocked: "等待处理",
  waiting_user: "等你操作",
  succeeded: "验证通过",
  failed: "验证失败",
  cancelled: "已经停止",
  interrupted: "验证中断"
};

const artifactKindLabels: Record<string, string> = {
  "test-log": "测试记录",
  "test-report": "测试报告",
  "source-patch": "修复内容",
  "workspace-diff": "修改记录",
  "verification-report": "验证报告",
  "product-prototype-html": "产品基础 HTML",
  "manual-release-checklist": "手工发布清单"
};

const toolStatusLabels: Record<string, string> = {
  started: "执行中",
  succeeded: "完成",
  failed: "失败",
  approval_required: "等待授权",
  denied: "未授权"
};

const cleanInline = (text: string) =>
  text.replace(/\*\*(.*?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1").trim();

const formatBytes = (size: number) => {
  if (size < 1_024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1_024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
};

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

function HarnessPanel({
  productionRunId,
  runStatus,
  harness
}: {
  productionRunId: string;
  runStatus: ProductionRun["status"];
  harness: HarnessView;
}) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const { failed: failedTest, passed: passedTest } = getHarnessTestEvidence(harness.evidence);

  async function control(kind: "steer" | "abort") {
    if (kind === "abort" && !window.confirm("确定停止本次运行吗？已产生的记录会保留。")) return;
    setSending(true);
    setControlMessage(null);
    try {
      if (kind === "steer") {
        await steerProductionRun(productionRunId, message, crypto.randomUUID());
        setMessage("");
        setControlMessage("调整指令已发送");
      } else {
        await abortProductionRun(productionRunId, "产品负责人从页面停止", crypto.randomUUID());
        setControlMessage("停止请求已发送");
      }
    } catch (error) {
      setControlMessage(getErrorMessage(error, "操作失败"));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel harness-panel" aria-labelledby="validation-title">
      <div className="run-panel-head">
        <div>
          <h2 id="validation-title">制作验证</h2>
          <p>{harness.objective}</p>
        </div>
        <span className={`run-status run-status-${harness.status}`}>
          {harnessStatusLabels[harness.status] ?? "状态待刷新"}
        </span>
      </div>

      <div className="harness-tests" aria-label="测试结果">
        <span className={failedTest ? "test-observation failed" : "test-observation"}>
          首次测试：{failedTest ? "发现问题" : "等待"}
        </span>
        <span className={passedTest ? "test-observation passed" : "test-observation"}>
          修复复测：{passedTest ? "通过" : "等待"}
        </span>
      </div>

      <div className="artifact-section" aria-label="运行产物">
        <h3>可查看的产物</h3>
        {harness.artifacts.length ? (
          <div className="harness-artifacts">
            {harness.artifacts.map((artifact) => (
              <a
                key={artifact.id}
                href={`/api/runs/${productionRunId}/artifacts/${artifact.id}`}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看${artifactKindLabels[artifact.kind] ?? artifact.kind}`}
              >
                <strong>{artifactKindLabels[artifact.kind] ?? "运行产物"}</strong>
                <span>{artifact.status === "ready" ? "可以查看" : "尚未完成"} · {formatBytes(artifact.size)}</span>
              </a>
            ))}
          </div>
        ) : <p className="harness-empty">产物还在生成。</p>}
      </div>

      {runStatus === "running" ? (
        <div className="harness-controls">
          <label htmlFor="steer-message">需要调整时告诉 AI</label>
          <div>
            <input id="steer-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="例如：先检查测试报错" />
            <button type="button" onClick={() => void control("steer")} disabled={sending || !message.trim()}>发送</button>
            <button className="danger-button" type="button" onClick={() => void control("abort")} disabled={sending}>停止</button>
          </div>
          {controlMessage ? <p role="status">{controlMessage}</p> : null}
        </div>
      ) : null}

      <details className="execution-details">
        <summary>查看执行详情</summary>
        {harness.plan.length ? (
          <ol className="harness-plan" aria-label="执行计划">
            {harness.plan.map((item) => (
              <li className={item.status} key={item.id}>
                <span>{item.status === "completed" ? "✓" : item.status === "in_progress" ? "→" : "·"}</span>
                {item.text}
              </li>
            ))}
          </ol>
        ) : <p className="harness-empty">正在建立计划。</p>}
        <div className="harness-tool-list" aria-label="最近 20 条工具记录">
          {harness.tools.length ? harness.tools.map((tool) => (
            <div key={tool.toolCallId}>
              <strong>{tool.toolName}</strong>
              <span>{toolStatusLabels[tool.status] ?? "状态待刷新"}</span>
              {tool.summary ? <p>{tool.summary}</p> : null}
            </div>
          )) : <p className="harness-empty">还没有工具记录。</p>}
        </div>
      </details>

      {harness.stopReason && harness.status !== "succeeded" ? <p className="form-error" role="alert">{harness.stopReason}</p> : null}
    </section>
  );
}

export function RunConsole({
  initialRun,
  initialEvents,
  initialHarness
}: {
  initialRun: ProductionRun;
  initialEvents: RunEvent[];
  initialHarness: HarnessView | null;
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(() => mergeRunEvents([], initialEvents));
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [harness, setHarness] = useState(initialHarness);
  // The first server and client render must use the same value. Live time starts
  // after hydration so crossing a second boundary cannot change the HTML text.
  const [clock, setClock] = useState(() => Date.parse(initialRun.createdAt));
  const [connection, setConnection] = useState<"connected" | "disconnected" | "stale">("connected");
  const latestSequence = useRef(initialEvents.reduce((maximum, event) => Math.max(maximum, event.sequence), 0));

  useEffect(() => {
    if (run.status !== "ready" && run.status !== "running") return;
    const initialTick = window.setTimeout(() => setClock(Date.now()), 0);
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, [run.status]);

  useEffect(() => {
    if (!["ready", "running"].includes(run.status)) return;
    return connectRunStream({
      runId: run.id,
      afterSequence: latestSequence.current,
      onEvent: (event) => {
        latestSequence.current = Math.max(latestSequence.current, event.sequence);
        setEvents((current) => mergeRunEvents(current, [event]));
      },
      onSnapshot: (snapshot) => {
        latestSequence.current = Math.max(latestSequence.current, snapshot.events.at(-1)?.sequence ?? 0);
        setRun(snapshot.run);
        setHarness(snapshot.harness);
        setEvents((current) => mergeRunEvents(current, snapshot.events));
      },
      onConnectionChange: setConnection
    });
  }, [run.id, run.status]);

  useEffect(() => {
    if (run.status !== "ready" && run.status !== "running") return;
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void getProductionRun(run.id)
        .then((snapshot) => {
          if (cancelled) return;
          setRun(snapshot.run);
          setHarness(snapshot.harness);
          setEvents((current) => mergeRunEvents(current, snapshot.events));
        })
        .catch(() => {
          if (!cancelled) setConnection("disconnected");
        });
    };
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [run.id, run.status]);

  const output = useMemo(
    () => events.filter((event) => event.type === "text.delta").map((event) => String(event.payload.delta ?? "")).join(""),
    [events]
  );
  const visibleOutput = useMemo(() => stripProductPrototype(output), [output]);
  const visibleEvents = useMemo(
    () => events.filter((event, index) => event.type !== "text.delta" || events[index + 1]?.type !== "text.delta").slice(-20),
    [events]
  );
  const currentStageIndex = Math.max(0, simpleStages.findIndex((stage) => stage.ids.includes(run.stage)));
  const approvedEvent = events.find((event) => event.type === "gate.approved");
  const nextRunId = approvedEvent?.payload.nextRunId;
  const harnessCompleted = events.some((event) => event.type === "harness.completed");
  const nextAction = harnessCompleted
    ? { title: "请检查上面的失败、修复和复测结果", button: "确认验证结果" }
    : nextActions[run.stage];
  const productPrototype = getProductPrototype(events);
  const resultIsConfirmable = hasConfirmableAgentResult(events);
  const requiredArtifactsReady =
    !["stage-design", "implementation", "real-acceptance"].includes(run.stage) ||
    (run.stage === "implementation" && harnessCompleted) ||
    Boolean(productPrototype);
  const canApprove = Boolean(nextAction) && !approvedEvent && resultIsConfirmable && requiredArtifactsReady &&
    (run.status === "waiting_approval" || run.status === "succeeded");
  const elapsedSeconds = Math.max(0, Math.floor((clock - Date.parse(run.createdAt)) / 1_000));
  const elapsedLabel = elapsedSeconds < 60 ? `${elapsedSeconds} 秒` : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
  const emptyPresentation = getEmptyRunPresentation(run, resultIsConfirmable, elapsedLabel);
  const stageReviewGuidance = getStageReviewGuidance(run.stage, productPrototype?.href ?? null);
  const productPreviewLabel = stageReviewGuidance?.previewLabel ??
    (run.stage === "implementation" && productPrototype
      ? "查看制作结果"
      : run.stage === "real-acceptance" && productPrototype ? "打开产品验收" : null);
  const connectionTaskStatus: TaskStatus = connection === "stale"
    ? "stale"
    : getTaskStatus(run.status, {
        streamConnected: connection === "connected",
        streamDisconnected: connection === "disconnected"
      });
  const taskStatus: TaskStatus = emptyPresentation.statusOverride ? "failed" : connectionTaskStatus;
  const taskPresentation = getTaskStatusPresentation(taskStatus);

  async function approve() {
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await approveProductionRun(run.id);
      if (result.nextRun) router.push(`/runs/${result.nextRun.id}`);
      else {
        setRun(result.completedRun);
        setApproving(false);
        router.refresh();
      }
    } catch (error) {
      setApprovalError(getErrorMessage(error, "无法进入下一步"));
      setApproving(false);
    }
  }

  return (
    <>
      <section className="simple-progress" aria-label="产品生产进度">
        <div className="simple-progress-compact">第 {currentStageIndex + 1} / {simpleStages.length} 步 · {simpleStages[currentStageIndex]?.label}</div>
        <ol>
          {simpleStages.map((stage, index) => (
            <li className={index < currentStageIndex ? "done" : index === currentStageIndex ? "current" : ""} key={stage.label}>
              <span>{index < currentStageIndex ? "✓" : index + 1}</span>{stage.label}
            </li>
          ))}
        </ol>
      </section>

      <section className={`task-status-card task-status-${taskStatus}`} aria-live="polite">
        <span>{taskPresentation.label}</span>
        <div><strong>{taskPresentation.now}</strong><p>{taskPresentation.action}</p></div>
      </section>

      <div className="run-layout run-layout-simple" id="ai-result">
        <section className="panel run-output-panel">
          <div className="run-panel-head">
            <h2>这一步的结果</h2>
            <span className={`run-status task-status-${taskStatus}`}>{taskPresentation.label}</span>
          </div>
          {visibleOutput ? <ResultDocument output={visibleOutput} /> : (
            <div className="waiting-output">
              {emptyPresentation.showActivity ? <span className="waiting-pulse" /> : null}
              <p>{emptyPresentation.message}</p>
              {emptyPresentation.canRetry ? <RetryRunButton runId={run.id} /> : null}
            </div>
          )}
          {productPrototype && productPreviewLabel && resultIsConfirmable ? (
            <div className="result-footer">
              <a className="result-preview-button" href={productPrototype.href} target="_blank" rel="noreferrer">{productPreviewLabel}</a>
            </div>
          ) : null}
          {visibleOutput && (run.status === "failed" || run.status === "blocked") ? (
            <div className="result-footer failure-result-footer">
              <p>{run.error || "这一步没有完成，已有结果会保留。"}</p>
              <RetryRunButton runId={run.id} />
            </div>
          ) : null}
          {canApprove && nextAction ? (
            <div className="result-confirmation" aria-labelledby="confirmation-title">
              <div>
                <strong id="confirmation-title">{nextAction.title}</strong>
                <p>确认后会进入下一步并保留当前结果；本阶段不会部署或发布。</p>
              </div>
              <div className="confirmation-actions">
                <button className="primary-button" type="button" onClick={() => void approve()} disabled={approving} aria-busy={approving}>
                  {approving ? "正在进入下一步…" : nextAction.button}
                </button>
                {approvalError ? <p className="form-error" role="alert">{approvalError}</p> : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {harness ? <HarnessPanel productionRunId={run.id} runStatus={run.status} harness={harness} /> : null}

      {typeof nextRunId === "string" ? (
        <section className="confirmation-card confirmation-complete">
          <div><h2>已确认</h2><p>当前结果已经保留，可以查看下一步。</p></div>
          <button className="primary-button" type="button" onClick={() => router.push(`/runs/${nextRunId}`)}>查看下一步</button>
        </section>
      ) : null}

      {approvedEvent?.payload.completed === true ? (
        <section className="confirmation-card confirmation-complete">
          <div>
            <h2>{run.stage === "release-handoff" ? "发布候选已生成" : "本阶段已确认"}</h2>
            <p>{run.stage === "release-handoff"
              ? "上线流程已完成，产品停在待人工发布；没有执行部署。"
              : "不会自动进入下一阶段，也不会发布或推送。"}</p>
          </div>
        </section>
      ) : null}

      <details className="run-log-details">
        <summary>查看运行记录</summary>
        <ol className="event-list">
          {visibleEvents.map((event) => (
            <li key={event.sequence}>
              <span className="event-dot" />
              <div><strong>{eventLabels[event.type] ?? "执行记录"}</strong>{event.type === "agent.failed" ? <p>{String(event.payload.message ?? "执行失败")}</p> : null}</div>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}
