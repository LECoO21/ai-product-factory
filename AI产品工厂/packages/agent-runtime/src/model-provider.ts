import {
  Agent,
  type AgentMessage,
  type AgentTool
} from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export type PiAgentCreateOptions = {
  sessionId: string;
  systemPrompt: string;
  modelName: string;
  thinkingLevel: "off" | "low" | "high";
  tools?: AgentTool[];
  messages?: AgentMessage[];
  maxRetryDelayMs?: number;
};

export interface PiAgentFactory {
  readonly providerId: string;
  isConfigured(): boolean;
  create(options: PiAgentCreateOptions): Agent;
}

/** DeepSeek is a replaceable model-provider adapter; Pi Agent remains the runtime. */
export class DeepSeekPiAgentFactory implements PiAgentFactory {
  readonly providerId = "deepseek";

  constructor(private readonly apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "") {}

  isConfigured() {
    return this.apiKey.length > 0;
  }

  create(options: PiAgentCreateOptions) {
    if (!this.isConfigured()) throw new Error("尚未配置 DEEPSEEK_API_KEY");
    const models = createModels();
    models.setProvider(deepseekProvider());
    const model = models.getModel(this.providerId, options.modelName);
    if (!model) throw new Error(`未知 DeepSeek 模型：${options.modelName}`);
    return new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model,
        thinkingLevel: options.thinkingLevel,
        ...(options.tools ? { tools: options.tools } : {}),
        ...(options.messages ? { messages: options.messages } : {})
      },
      streamFn: models.streamSimple.bind(models),
      getApiKey: (provider) => provider === this.providerId ? this.apiKey : undefined,
      sessionId: options.sessionId,
      toolExecution: "sequential",
      ...(options.maxRetryDelayMs === undefined
        ? {}
        : { maxRetryDelayMs: options.maxRetryDelayMs })
    });
  }
}
