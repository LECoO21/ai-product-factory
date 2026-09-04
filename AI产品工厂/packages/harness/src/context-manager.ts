import type { ToolResultEnvelope } from "./tool-gateway";

const DEFAULT_MAX_TOOL_RESULT_BYTES = 32_000;

export type ContextManagerOptions = {
  maxToolResultBytes?: number;
};

/**
 * 负责在工具结果回传给模型前做上下文裁剪。
 *
 * 边界：三份原始手册、当前生产目标、重大决定和未解决错误不经过本模块，
 * 由 ManualAuthority 与完成目标独立管理，永不压缩、永不删除。
 */
export class ContextManager {
  private readonly maxToolResultBytes: number;

  constructor(options: ContextManagerOptions = {}) {
    this.maxToolResultBytes = options.maxToolResultBytes ?? DEFAULT_MAX_TOOL_RESULT_BYTES;
  }

  trimToolResult(result: ToolResultEnvelope): ToolResultEnvelope {
    if (result.data === undefined || result.data === null) return result;
    const serialized = JSON.stringify(result.data);
    if (serialized.length <= this.maxToolResultBytes) return result;
    return {
      ...result,
      data: {
        truncated: true,
        originalBytes: serialized.length,
        maxBytes: this.maxToolResultBytes,
        preview: serialized.slice(0, this.maxToolResultBytes),
        summary: result.summary
      }
    };
  }
}
