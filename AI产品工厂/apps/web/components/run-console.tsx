"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileCheck2,
  History,
  ListChecks,
  Send,
  Square
} from "lucide-react";
import {
  getProductPrototype,
  hasConfirmableAgentResult,
  type ProductionRun,
  type ProductionStage,
  type RunEvent
} from "@factory/shared";
import {
  abortProductionRun,
  approveProductionRun,
  getProductionRun,
  reviseProductionRun,
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
  getResultHeading,
  getStageReviewGuidance
} from "@/lib/run-presentation";
import { connectRunStream } from "@/lib/stream/run-stream-client";
import { mergeRunEvents } from "@/lib/stream/run-stream";
import { RetryRunButton } from "@/components/retry-run-button";
import type { HarnessView } from "@/lib/harness-types";
import type { ConversationRun } from "@/lib/run-conversation";
import { buildChatEntries } from "@/lib/run-chat";

const eventLabels: Record<string, string> = {
  "run.created": "任务已创建",
  "run.claimed": "开始处理",
  "agent.started": "AI 已开始",
  "turn.started": "AI 正在处理",
  "text.delta": "AI 输出",
  "tool.started": "开始执行",
  "tool.completed": "执行完成",
  "plan.updated": "执行计划已更新",
  "artifact.created": "产物已生成",
  "run.cancelled": "当前任务已停止",
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
  "harness.command.receipt": "运行控制回执",
  "gate.requested": "需要你确认",
  "gate.revision_requested": "你已提交修改，正在生成新版本",
  "gate.approved": "你已确认，进入下一步"
};

const simpleStages: Array<{ ids: ProductionStage[]; label: string }> = [
  { ids: ["intake"], label: "需求分析" },
  { ids: ["adaptation"], label: "技术方案" },
  { ids: ["stage-design"], label: "开发计划" },
  { ids: ["implementation"], label: "制作产品" },
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
        if (heading) return <h3 key={index}>{getResultHeading(cleanInline(heading[1] ?? ""))}</h3>;
        const bullet = value.match(/^[-*]\s+(.*)$/);
        if (bullet) return <p className="result-bullet" key={index}>{cleanInline(bullet[1] ?? "")}</p>;
        return <p key={index}>{cleanInline(value)}</p>;
      })}
    </div>
  );
}

function HarnessPanel({
  productionRunId,
  harness
}: {
  productionRunId: string;
  harness: HarnessView;
}) {
  const { failed: failedTest, passed: passedTest } = getHarnessTestEvidence(harness.evidence);
  const toolRecords = (tools: HarnessView["tools"]) => tools.map((tool) => (
    <div key={tool.toolCallId}>
      <strong>{tool.toolName}</strong>
      <span>{toolStatusLabels[tool.status] ?? "状态待刷新"}</span>
      {tool.summary ? <p>{tool.summary}</p> : null}
    </div>
  ));

  return (
    <section className="panel harness-panel" aria-labelledby={`validation-title-${productionRunId}`}>
      <div className="run-panel-head">
        <div>
          <h2 id={`validation-title-${productionRunId}`}>制作验证</h2>
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
                <strong>{artifactKindLabels[artifact.kind] ?? "运行产物"}<ArrowUpRight aria-hidden="true" /></strong>
                <span>{artifact.status === "ready" ? "可以查看" : "尚未完成"} · {formatBytes(artifact.size)}</span>
              </a>
            ))}
          </div>
        ) : <p className="harness-empty">产物还在生成。</p>}
      </div>

      <details className="execution-details">
        <summary><ListChecks aria-hidden="true" />查看执行详情<ChevronDown className="details-chevron" aria-hidden="true" /></summary>
        {harness.plan.length ? (
          <ol className="harness-plan" aria-label="执行计划">
            {harness.plan.map((item) => (
              <li className={item.status} key={item.id}>
                <span>{item.status === "completed" ? <Check aria-hidden="true" /> : item.status === "in_progress" ? "→" : "·"}</span>
                {item.text}
              </li>
            ))}
          </ol>
        ) : <p className="harness-empty">正在建立计划。</p>}
        {harness.tools.length > 20 ? (
          <details className="chat-execution-details">
            <summary>查看更早的 {harness.tools.length - 20} 条工具记录</summary>
            <div className="harness-tool-list">{toolRecords(harness.tools.slice(0, -20))}</div>
          </details>
        ) : null}
        <div className="harness-tool-list" aria-label="最近 20 条工具记录">
          {harness.tools.length ? toolRecords(harness.tools.slice(-20)) : <p className="harness-empty">还没有工具记录。</p>}
        </div>
      </details>

      {harness.stopReason && harness.status !== "succeeded" ? <p className="form-error" role="alert">{harness.stopReason}</p> : null}
    </section>
  );
}

function ChatMessage({ user = false, children }: { user?: boolean; children: ReactNode }) {
  return (
    <div className={`chat-message chat-message-${user ? "user" : "assistant"}`}>
      <div className={`chat-message-content${user ? " chat-user-bubble" : ""}`}>{children}</div>
    </div>
  );
}

function ExecutionRecord({ events }: { events: RunEvent[] }) {
  const list = (items: RunEvent[]) => (
    <ol className="event-list">
      {items.map((event) => (
        <li key={event.id}>
          <span className="event-dot" />
          <div>
            <strong>{event.type.startsWith("tool.") && (event.payload.status === "failed" || event.payload.success === false)
              ? "执行失败" : eventLabels[event.type] ?? "执行记录"}</strong>
            {typeof event.payload.toolName === "string" ? <p>{event.payload.toolName}</p> : null}
            {typeof event.payload.message === "string" ? <p>{event.payload.message}</p> : null}
            {typeof event.payload.error === "string" ? <p>原因：{event.payload.error}</p> : null}
            {typeof event.payload.summary === "string" ? <p>{event.payload.summary}</p> : null}
            {typeof event.payload.explanation === "string" ? <p>{event.payload.explanation}</p> : null}
            {event.type === "plan.updated" && Array.isArray(event.payload.plan) ? (
              <ol className="chat-plan-record">
                {event.payload.plan.map((item: unknown, index: number) => {
                  if (!item || typeof item !== "object" || !("step" in item) || typeof item.step !== "string") return null;
                  const status = "status" in item ? item.status : null;
                  return <li key={index}>{item.step} · {status === "completed" ? "已完成" : status === "in_progress" ? "进行中" : "待处理"}</li>;
                })}
              </ol>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
  return (
    <details className="chat-execution-details run-log-details">
      <summary><History aria-hidden="true" />查看运行记录 · {events.length} 条<ChevronDown className="details-chevron" aria-hidden="true" /></summary>
      {events.length > 20 ? (
        <details>
          <summary>查看更早的 {events.length - 20} 条记录</summary>
          {list(events.slice(0, -20))}
        </details>
      ) : null}
      {list(events.slice(-20))}
    </details>
  );
}

function userActionText(event: RunEvent, run: ProductionRun, harnessCompleted: boolean) {
  if (event.type === "gate.revision_requested") return String(event.payload.feedback ?? "请重新分析当前步骤");
  if (event.type === "harness.command.steer") return String(event.payload.message ?? "调整当前任务");
  if (event.type === "harness.command.abort") return String(event.payload.reason ?? "终止流程");
  return harnessCompleted ? "确认验证结果" : nextActions[run.stage]?.button ?? "确认当前结果";
}

function ConversationStage({
  run, events, harness, status, children
}: ConversationRun & { status?: ReactNode; children?: ReactNode }) {
  const entries = useMemo(() => buildChatEntries(events), [events]);
  const prototype = getProductPrototype(events);
  const stage = simpleStages.find((item) => item.ids.includes(run.stage));
  const revised = events.some((event) => event.type === "gate.revision_requested");
  const harnessCompleted = events.some((event) => event.type === "harness.completed");
  const resolutionIndex = entries.findIndex((entry) => entry.kind === "user" && entry.event.type.startsWith("gate."));
  const previewLabel = getStageReviewGuidance(run.stage, prototype?.href ?? null)?.previewLabel ??
    (run.stage === "real-acceptance" ? "打开产品验收" : "查看制作结果");
  const attachments = prototype || harness ? (
    <ChatMessage>
      <div className="chat-artifacts">
        {prototype ? <a className="result-preview-button" href={prototype.href} target="_blank" rel="noreferrer">{previewLabel}<ArrowUpRight aria-hidden="true" /></a> : null}
        {harness ? <HarnessPanel productionRunId={run.id} harness={harness} /> : null}
      </div>
    </ChatMessage>
  ) : null;
  return (
    <section className="chat-stage" data-run-id={run.id} aria-label={stage?.label}>
      <div className="chat-stage-divider">
        <span>{stage?.label}</span>
        {status ?? <span className="run-status">{revised ? "已按反馈重做" : getTaskStatusPresentation(getTaskStatus(run.status)).label}</span>}
      </div>
      {entries.map((entry, index) => (
        <Fragment key={entry.key}>
          {index === resolutionIndex ? attachments : null}
          {entry.kind === "output" ? <ChatMessage><ResultDocument output={entry.text} /></ChatMessage> :
            entry.kind === "activity" ? <>
              {entry.events.filter((event) => event.type === "harness.command.receipt" && event.payload.accepted === false).map((event) => (
                <ChatMessage key={event.id}><p className="form-error" role="alert">指令未执行：{String(event.payload.message ?? "请重试")}</p></ChatMessage>
              ))}
              <ExecutionRecord events={entry.events} />
            </> :
              <ChatMessage user><p>{userActionText(entry.event, run, harnessCompleted)}</p></ChatMessage>}
        </Fragment>
      ))}
      {resolutionIndex < 0 ? attachments : null}
      {children}
    </section>
  );
}

export function RunConsole({
  initialRun,
  initialEvents,
  initialHarness,
  projectPrd = "",
  history = []
}: {
  initialRun: ProductionRun;
  initialEvents: RunEvent[];
  initialHarness: HarnessView | null;
  projectPrd?: string;
  history?: ConversationRun[];
}) {
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(() => mergeRunEvents([], initialEvents));
  const [serverEvents, setServerEvents] = useState(initialEvents);
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [revising, setRevising] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopRequested, setStopRequested] = useState(false);
  const [completedLocally, setCompletedLocally] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [harness, setHarness] = useState(initialHarness);
  // router.refresh preserves this component for the same Run. Reconcile the new
  // server snapshot so durable confirmations also recover after a failed fetch.
  if (serverEvents !== initialEvents) {
    setServerEvents(initialEvents);
    setEvents((current) => mergeRunEvents(current, initialEvents));
    if (initialRun.updatedAt >= run.updatedAt) {
      setRun(initialRun);
      setHarness(initialHarness);
    }
    if (initialEvents.some((event) => event.type === "gate.approved")) setApprovalError(null);
  }
  const scrollRef = useRef<HTMLElement>(null);
  const nearBottom = useRef(true);
  // The first server and client render must use the same value. Live time starts
  // after hydration so crossing a second boundary cannot change the HTML text.
  const [clock, setClock] = useState(() => Date.parse(initialRun.createdAt));
  const [connection, setConnection] = useState<"connected" | "disconnected" | "stale">("connected");
  const latestSequence = useRef(initialEvents.reduce((maximum, event) => Math.max(maximum, event.sequence), 0));

  useEffect(() => {
    const scroll = scrollRef.current;
    if (scroll && nearBottom.current) scroll.scrollTop = scroll.scrollHeight;
  }, [events, harness, feedbackError, approvalError, run.status]);

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

  const hasVisibleOutput = useMemo(
    () => buildChatEntries(events).some((entry) => entry.kind === "output" && entry.text.trim()),
    [events]
  );
  const approvedEvent = events.find((event) => event.type === "gate.approved");
  const revisionEvent = events.find((event) => event.type === "gate.revision_requested");
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
  const failedQuality = run.stage === "automated-quality" && run.status === "failed" &&
    events.some((event) => event.type === "quality.failed" ||
      (event.type === "quality.completed" && event.payload.passed === false));
  const canRevise = !approvedEvent && !revisionEvent && !completedLocally && (failedQuality ||
    (resultIsConfirmable && (run.status === "waiting_approval" || run.status === "succeeded")));
  const canApprove = Boolean(nextAction) && canRevise && !failedQuality && requiredArtifactsReady;
  const active = run.status === "ready" || run.status === "running";
  const latestAbort = [...events].reverse().find((event) => event.type === "harness.command.abort");
  const abortRejected = latestAbort && events.some((event) => event.type === "harness.command.receipt" &&
    event.payload.commandSequence === latestAbort.sequence && event.payload.accepted === false);
  const abortPending = !abortRejected && (stopRequested || Boolean(latestAbort));
  const canCompose = canRevise || (run.status === "running" && !abortPending);
  const busy = approving || revising || stopping;
  const elapsedSeconds = Math.max(0, Math.floor((clock - Date.parse(run.createdAt)) / 1_000));
  const elapsedLabel = elapsedSeconds < 60 ? `${elapsedSeconds} 秒` : `${Math.floor(elapsedSeconds / 60)} 分 ${elapsedSeconds % 60} 秒`;
  const emptyPresentation = getEmptyRunPresentation(run, resultIsConfirmable, elapsedLabel);
  const connectionTaskStatus: TaskStatus = connection === "stale"
    ? "stale"
    : getTaskStatus(run.status, {
        streamConnected: connection === "connected",
        streamDisconnected: connection === "disconnected"
      });
  const taskStatus: TaskStatus = emptyPresentation.statusOverride ? "failed" : connectionTaskStatus;
  const taskPresentation = getTaskStatusPresentation(taskStatus);

  async function syncSnapshot() {
    const snapshot = await getProductionRun(run.id);
    setRun(snapshot.run);
    setHarness(snapshot.harness);
    latestSequence.current = Math.max(latestSequence.current, snapshot.events.at(-1)?.sequence ?? 0);
    setEvents((current) => mergeRunEvents(current, snapshot.events));
  }

  async function approve() {
    setApproving(true);
    setApprovalError(null);
    try {
      const result = await approveProductionRun(run.id);
      if (result.nextRun) router.push(`/runs/${result.nextRun.id}`);
      else {
        setRun(result.completedRun);
        setCompletedLocally(true);
        setApproving(false);
        await syncSnapshot().catch(() => setApprovalError("已确认，记录暂未同步，请刷新页面查看。"));
        router.refresh();
      }
    } catch (error) {
      setApprovalError(getErrorMessage(error, "无法进入下一步"));
      setApproving(false);
    }
  }

  async function sendMessage() {
    const normalizedFeedback = feedback.trim();
    if (!normalizedFeedback || !canCompose || busy) return;
    nearBottom.current = true;
    setRevising(true);
    setFeedbackError(null);
    try {
      if (canRevise) {
        const result = await reviseProductionRun(run.id, normalizedFeedback);
        router.push(`/runs/${result.run.id}`);
      } else {
        const result = await steerProductionRun(run.id, normalizedFeedback, crypto.randomUUID());
        if (!result.receipt.accepted) throw new Error("调整指令未被接受，请重试");
        setFeedback("");
        await syncSnapshot().catch(() => setFeedbackError("调整指令已发送，记录暂未同步，请稍后刷新。"));
        setRevising(false);
      }
    } catch (error) {
      setFeedbackError(getErrorMessage(error, "无法根据反馈重新分析"));
      setRevising(false);
    }
  }

  async function stop() {
    if (busy || abortPending || !window.confirm("确定终止这个产品流程吗？已有记录会保留；如需继续，请新建产品。")) return;
    setStopping(true);
    setFeedbackError(null);
    nearBottom.current = true;
    try {
      const result = await abortProductionRun(run.id, "终止流程", crypto.randomUUID());
      if (!result.receipt.accepted) throw new Error("停止请求未被接受，请重试");
      setStopRequested(true);
      await syncSnapshot().catch(() => setFeedbackError("停止请求已发送，记录暂未同步，请刷新查看。"));
      router.refresh();
    } catch (error) {
      setFeedbackError(getErrorMessage(error, "无法终止流程"));
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="run-console chat-workspace">
      <main
        className="chat-scroll"
        id="ai-result"
        aria-label="对话记录"
        ref={scrollRef}
        tabIndex={0}
        onScroll={() => {
          const scroll = scrollRef.current;
          if (!scroll) return;
          nearBottom.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
          setShowLatest(!nearBottom.current);
        }}
      >
        <div className="chat-thread">
          {projectPrd ? <ChatMessage user><p>{projectPrd}</p></ChatMessage> : null}
          {history.map((item) => <ConversationStage key={item.run.id} {...item} />)}
          <ConversationStage
            run={run}
            events={events}
            harness={harness}
            status={<span className={`run-status task-status-${taskStatus}`} role="status">{taskPresentation.label}</span>}
          >
            {(!hasVisibleOutput || active || run.status === "cancelled") ? (
              <ChatMessage>
                <div className="waiting-output" role="status">
                  {emptyPresentation.showActivity ? <span className="waiting-pulse" /> : null}
                  <p>{revisionEvent ? "已提交修改，前面的结果已保留。" : abortPending && active ? "正在停止，已有记录会保留。" : emptyPresentation.message}</p>
                  {emptyPresentation.canRetry ? <RetryRunButton runId={run.id} /> : null}
                </div>
              </ChatMessage>
            ) : null}

            {hasVisibleOutput && (run.status === "failed" || run.status === "blocked" || emptyPresentation.statusOverride) ? (
              <ChatMessage>
                <div className="result-footer failure-result-footer">
                  <p>{run.error || "这一步没有完成，已有结果会保留。"}</p>
                  {failedQuality ? <p>在下方说明修改要求，返回产品制作；如果仅需复查，可重新检查原版本。</p> : null}
                  <RetryRunButton runId={run.id} label={failedQuality ? "仅重新检查" : "重新分析"} />
                </div>
              </ChatMessage>
            ) : null}

            {canApprove && nextAction ? (
              <ChatMessage>
                <section className="result-confirmation chat-confirmation" aria-labelledby="confirmation-title">
                  <div className="confirmation-copy">
                    <span className="inspector-section-label"><FileCheck2 aria-hidden="true" />等待验收</span>
                    <strong id="confirmation-title">{nextAction.title}</strong>
                    <p>确认后进入下一步并保留结果；本阶段不会部署或发布。</p>
                  </div>
                  <div className="confirmation-actions">
                    <button className="primary-button" type="button" onClick={() => void approve()} disabled={busy || abortPending} aria-busy={approving}>
                      <Check aria-hidden="true" />
                      {approving ? "正在进入下一步…" : nextAction.button}
                    </button>
                  </div>
                </section>
              </ChatMessage>
            ) : null}

            {typeof nextRunId === "string" ? (
              <ChatMessage>
                <div className="confirmation-complete">
                  <p>当前结果已经确认并保留。</p>
                  <button className="secondary-button" type="button" onClick={() => router.push(`/runs/${nextRunId}`)}>
                    查看下一步<ArrowUpRight aria-hidden="true" />
                  </button>
                </div>
              </ChatMessage>
            ) : null}

            {typeof revisionEvent?.payload.revisionRunId === "string" ? (
              <ChatMessage>
                <button className="secondary-button" type="button" onClick={() => router.push(`/runs/${revisionEvent.payload.revisionRunId}`)}>
                  查看修改后的版本<ArrowUpRight aria-hidden="true" />
                </button>
              </ChatMessage>
            ) : null}

            {approvedEvent?.payload.completed === true || completedLocally ? (
              <ChatMessage>
                <div className="confirmation-complete">
                  <h2>{run.stage === "release-handoff" ? "发布候选已生成" : "本阶段已确认"}</h2>
                  <p>{run.stage === "release-handoff"
                    ? "上线流程已完成，产品停在待人工发布；没有执行部署。"
                    : "不会自动进入下一阶段，也不会发布或推送。"}</p>
                </div>
              </ChatMessage>
            ) : null}
            {approvalError || feedbackError ? <ChatMessage><p className="form-error" role="alert">{approvalError || feedbackError}</p></ChatMessage> : null}
          </ConversationStage>
        </div>
      </main>

      <div className={`chat-composer-dock${canRevise || active ? "" : " chat-composer-dock-readonly"}`}>
        {showLatest ? (
          <button
            className="chat-jump-latest"
            type="button"
            onClick={() => {
              const scroll = scrollRef.current;
              if (scroll) scroll.scrollTop = scroll.scrollHeight;
              nearBottom.current = true;
              setShowLatest(false);
            }}
          ><ArrowDown aria-hidden="true" />回到最新</button>
        ) : null}

        {canRevise || active ? (
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
            <label className="sr-only" htmlFor={`chat-input-${run.id}`}>{canRevise ? "补充回答或修改意见" : "补充要求或调整指令"}</label>
            <textarea
              className="chat-composer-input"
              id={`chat-input-${run.id}`}
              value={feedback}
              onChange={(event) => setFeedback(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={canRevise ? "回答 AI 的问题，或说明要修改的内容…" : run.status === "ready" ? "AI 开始处理后，可以在这里补充要求…" : "继续补充要求，或告诉 AI 怎么调整…"}
              rows={2}
              maxLength={canRevise ? 2000 : 1000}
              disabled={busy || !canCompose || abortPending}
            />
            <div className="chat-composer-actions">
              <span>{failedQuality ? "提交后返回产品制作，修复后重新检查。" : canRevise ? "提交后重做当前步骤，不会直接前进。" : abortPending ? "正在停止…" : "生成过程中也可以补充要求。"}</span>
              <div>
                <button className="chat-stop-button" type="button" onClick={() => void stop()} disabled={busy || abortPending}>
                  <Square aria-hidden="true" />{stopping || abortPending ? "正在停止…" : "终止流程"}
                </button>
                <button
                  className="primary-button composer-submit"
                  type="submit"
                  disabled={busy || !canCompose || abortPending || !feedback.trim()}
                  aria-busy={revising}
                  aria-label={revising ? (canRevise ? "正在重新分析…" : "正在发送…") : canRevise ? "提交并重新分析" : "发送"}
                  title={canRevise ? "提交并重新分析" : "发送"}
                ><Send aria-hidden="true" /></button>
              </div>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  );
}
