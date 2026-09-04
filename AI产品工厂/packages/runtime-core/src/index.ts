import {
  createProtocolEventPublisher,
  factoryCommandSchema,
  legacyCommandType,
  type FactoryCommand,
  type ProtocolEventPublisher,
  type ProtocolEventStore
} from "@factory/protocol";
import {
  hasConfirmableAgentResult,
  type ProductProject,
  type ProductionRun
} from "@factory/shared";

export type TurnOutcome =
  | { kind: "awaiting_approval"; approvalId: string; gate: string }
  | { kind: "completed"; reason?: string }
  | { kind: "failed"; message: string }
  | { kind: "blocked"; message: string }
  | { kind: "interrupted"; message: string };

export type RuntimeTurnContext = {
  threadId: string;
  turnId: string;
  run: ProductionRun;
  project: ProductProject;
  events: ProtocolEventPublisher;
};

export interface RuntimeTurnHandler {
  readonly id: string;
  supports(run: ProductionRun, project: ProductProject): boolean;
  execute(context: RuntimeTurnContext): Promise<TurnOutcome>;
}

export interface RuntimeTurnStore extends ProtocolEventStore {
  get(id: string): ProductionRun | null;
  transition(
    id: string,
    status: ProductionRun["status"],
    error?: string | null
  ): ProductionRun;
}

export class FactoryRuntimeCore {
  constructor(
    private readonly store: RuntimeTurnStore,
    private readonly handlers: RuntimeTurnHandler[]
  ) {}

  async execute(run: ProductionRun, project: ProductProject) {
    if (run.projectId !== project.id) throw new Error("生产批次不属于当前产品项目");
    if (run.status !== "running") throw new Error("只有已领取的生产批次可以进入运行核心");
    const events = createProtocolEventPublisher(this.store, {
      threadId: project.id,
      turnId: run.id
    });
    events.emit("thread.configured", {
      stage: run.stage,
      runtime: "codex-app-server",
      modelProvider: "openai-account",
      controller: "deterministic"
    });
    events.emit("turn.started", { stage: run.stage, objective: run.objective });

    const handler = this.handlers.find((candidate) => candidate.supports(run, project));
    let outcome: TurnOutcome;
    if (!handler) {
      outcome = { kind: "blocked", message: "当前工位尚未注册运行处理器" };
    } else {
      events.emit("item.started", { itemId: `handler:${handler.id}`, kind: "station_handler" });
      try {
        outcome = await handler.execute({
          threadId: project.id,
          turnId: run.id,
          run,
          project,
          events
        });
      } catch (error) {
        outcome = {
          kind: "failed",
          message: error instanceof Error ? error.message : "运行处理器异常退出"
        };
      }
      events.emit("item.completed", {
        itemId: `handler:${handler.id}`,
        kind: "station_handler",
        outcome: outcome.kind
      });
    }

    if (outcome.kind === "awaiting_approval") {
      if (!hasConfirmableAgentResult(this.store.events(run.id))) {
        const message = "当前工位没有生成真实可确认结果";
        events.emit("turn.failed", { message, code: "confirmable_result_missing" });
        return this.store.transition(run.id, "failed", message);
      }
      events.legacy("gate.requested", {
        approvalId: outcome.approvalId,
        gate: outcome.gate,
        stage: run.stage
      });
      events.emit("turn.awaiting_approval", {
        approvalId: outcome.approvalId,
        gate: outcome.gate
      });
      return this.store.transition(run.id, "waiting_approval");
    }
    if (outcome.kind === "completed") {
      events.emit("turn.completed", { reason: outcome.reason ?? "completed" });
      return this.store.transition(run.id, "succeeded");
    }
    if (outcome.kind === "blocked") {
      events.emit("turn.blocked", { message: outcome.message });
      return this.store.transition(run.id, "blocked", outcome.message);
    }
    if (outcome.kind === "interrupted") {
      events.emit("turn.interrupted", { message: outcome.message });
      return this.store.transition(run.id, "cancelled", outcome.message);
    }
    events.emit("turn.failed", { message: outcome.message });
    return this.store.transition(run.id, "failed", outcome.message);
  }
}

export type CommandReceipt = {
  accepted: boolean;
  commandId: string;
  commandSequence: number;
  duplicate: boolean;
};

/**
 * Transport-neutral command ingress. HTTP routes, a CLI, or a future app server
 * all submit the same protocol command and receive the same durable receipt.
 */
export class RuntimeCommandGateway {
  constructor(private readonly store: RuntimeTurnStore) {}

  submit(input: FactoryCommand): CommandReceipt {
    const command = factoryCommandSchema.parse(input);
    const run = this.store.get(command.turnId);
    if (!run) throw new Error("运行不存在");
    if (run.projectId !== command.threadId) throw new Error("线程与生产批次不匹配");
    if (command.type === "approval.resolve") {
      throw new Error("确认命令必须由生产控制器执行");
    }
    if (run.status !== "running") throw new Error("当前运行不能接收控制指令");

    const legacyType = legacyCommandType(command);
    const existing = this.store.events(run.id).find(
      (event) => event.type === legacyType && event.payload.idempotencyKey === command.id
    );
    if (existing) {
      return {
        accepted: true,
        commandId: command.id,
        commandSequence: existing.sequence,
        duplicate: true
      };
    }

    const events = createProtocolEventPublisher(this.store, {
      threadId: command.threadId,
      turnId: command.turnId
    });
    const payload = command.type === "turn.steer"
      ? { message: command.message, idempotencyKey: command.id }
      : { reason: command.reason, idempotencyKey: command.id };
    const event = events.legacy(legacyType, payload);
    return {
      accepted: true,
      commandId: command.id,
      commandSequence: event.sequence,
      duplicate: false
    };
  }
}
