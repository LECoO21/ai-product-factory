import { z, type ZodType } from "zod";

const structuredErrorSchema = z.object({
  error: z.object({
    code: z.string().optional(),
    message: z.string().optional(),
    userMessage: z.string().optional(),
    retryable: z.boolean().optional(),
    requestId: z.string().optional(),
    fieldErrors: z.record(z.string(), z.array(z.string())).optional()
  })
});

const legacyErrorSchema = z.object({ error: z.string() });

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly userMessage: string,
    public readonly retryable: boolean,
    public readonly requestId?: string,
    public readonly fieldErrors?: Record<string, string[]>
  ) {
    super(userMessage);
    this.name = "AppError";
  }
}

type RequestJsonOptions<T> = Omit<RequestInit, "signal"> & {
  schema: ZodType<T>;
  timeoutMs?: number;
  signal?: AbortSignal;
};

function parseError(payload: unknown, status: number) {
  const structured = structuredErrorSchema.safeParse(payload);
  if (structured.success) {
    const error = structured.data.error;
    return new AppError(
      error.code ?? `HTTP_${status}`,
      error.userMessage ?? error.message ?? "操作失败，请稍后重试。",
      error.retryable ?? status >= 500,
      error.requestId,
      error.fieldErrors
    );
  }
  const legacy = legacyErrorSchema.safeParse(payload);
  if (legacy.success) {
    return new AppError(`HTTP_${status}`, legacy.data.error, status >= 500);
  }
  return new AppError(`HTTP_${status}`, "操作失败，请稍后重试。", status >= 500);
}

export async function requestJson<T>(url: string, options: RequestJsonOptions<T>): Promise<T> {
  const { schema, timeoutMs = 15_000, signal, headers, ...requestOptions } = options;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  try {
    const response = await fetch(url, {
      ...requestOptions,
      headers: {
        Accept: "application/json",
        ...(requestOptions.body ? { "Content-Type": "application/json" } : {}),
        ...headers
      },
      signal: combinedSignal
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw parseError(payload, response.status);
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new AppError(
        "INVALID_RESPONSE",
        "服务返回了无法识别的数据，请刷新后重试。",
        true
      );
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new AppError("REQUEST_TIMEOUT", "等待时间较长，请稍后重试。", true);
    }
    throw new AppError("NETWORK_ERROR", "网络连接失败，请检查连接后重试。", true);
  }
}

export const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof AppError || error instanceof Error ? error.message : fallback;
