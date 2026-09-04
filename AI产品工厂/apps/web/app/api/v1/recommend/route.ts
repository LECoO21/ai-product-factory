/**
 * Historical prototype endpoint. Factory AI work now runs exclusively through
 * the Worker-owned Codex App Server; Web routes must not call a model directly.
 */
export function POST() {
  return Response.json(
    {
      error: {
        code: "LEGACY_MODEL_ENDPOINT_REMOVED",
        message: "该基础稿接口已停用，请在产品工厂流程中使用 Codex 生产。"
      }
    },
    { status: 410 }
  );
}
