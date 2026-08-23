import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import {
  buildRecommendationPrompt,
  parseRecommendation,
  recommendationInputSchema
} from "@/lib/recommendation";
import { loadFactoryEnvironment } from "@/lib/server-env";

type DeepSeekResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const errorResponse = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status });

export async function POST(request: Request) {
  loadFactoryEnvironment();
  let input;
  try {
    input = recommendationInputSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "输入不合法，请检查后重试。")
        : "请求内容必须是有效的 JSON。";
    return errorResponse("VALIDATION_ERROR", message, 400);
  }

  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) return errorResponse("MODEL_ERROR", "推荐服务尚未配置。", 503);

  const baseUrl = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com").replace(
    /\/$/,
    ""
  );
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "你是谨慎的外卖推荐助手。严格遵守用户忌口，只给一个具体菜品和简短理由。"
          },
          { role: "user", content: buildRecommendationPrompt(input) }
        ],
        temperature: 0.4,
        max_tokens: 1_000,
        stream: false
      }),
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      return errorResponse("MODEL_ERROR", "推荐服务暂时不可用，请稍后重试。", 502);
    }

    const payload = (await response.json()) as DeepSeekResponse;
    const recommendation = parseRecommendation(payload.choices?.[0]?.message?.content ?? "");
    if (!recommendation) {
      return errorResponse("RECOMMENDATION_PARSE_ERROR", "本次推荐结果不完整，请重试。", 502);
    }

    return Response.json({
      request_id: `req_${randomUUID()}`,
      recommendation
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    return errorResponse(
      timedOut ? "MODEL_TIMEOUT" : "MODEL_ERROR",
      timedOut ? "推荐时间较长，请稍后重试。" : "推荐服务暂时不可用，请稍后重试。",
      timedOut ? 504 : 502
    );
  }
}
