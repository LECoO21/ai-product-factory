"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProductionRun, RunEvent } from "@factory/shared";
import { runStatusLabels } from "@/lib/labels";

const eventLabels: Record<string, string> = {
  "run.created": "生产批次已创建",
  "run.claimed": "本机 Worker 已领取",
  "agent.started": "Pi Agent 已启动",
  "turn.started": "DeepSeek 开始推理",
  "text.delta": "模型输出",
  "tool.started": "工具开始执行",
  "tool.completed": "工具执行结束",
  "agent.completed": "Pi Agent 已完成",
  "agent.failed": "Agent 运行受阻",
  "run.blocked": "生产批次等待配置",
  "run.succeeded": "生产批次完成",
  "run.failed": "生产批次失败"
};

export function RunConsole({ initialRun, initialEvents }: { initialRun: ProductionRun; initialEvents: RunEvent[] }) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState(initialEvents);

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

  return (
    <div className="run-layout">
      <section className="panel run-output-panel">
        <div className="run-panel-head">
          <div>
            <span className="eyebrow">Live Agent Output</span>
            <h2>{runStatusLabels[run.status]}</h2>
          </div>
          <span className={`run-status run-status-${run.status}`}>{run.status}</span>
        </div>
        {output ? (
          <pre className="agent-output">{output}</pre>
        ) : (
          <div className="waiting-output">
            <span className="waiting-pulse" />
            <p>
              {run.status === "blocked"
                ? run.error
                : "生产单已进入持久化队列，正在等待 Worker 或 Agent 事件。"}
            </p>
          </div>
        )}
      </section>

      <aside className="panel event-panel">
        <h2>生产事件</h2>
        <ol className="event-list">
          {events.map((event) => (
            <li key={event.sequence}>
              <span className="event-dot" />
              <div>
                <strong>{eventLabels[event.type] ?? event.type}</strong>
                <small>#{event.sequence}</small>
                {event.type === "agent.failed" ? (
                  <p>{String(event.payload.message ?? "执行失败")}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
