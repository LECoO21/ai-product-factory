import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNodeRuntime } = await import("./instrumentation-node");
    await registerNodeRuntime();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { captureNodeRequestError } = await import("./instrumentation-node");
    await captureNodeRequestError(error, request, context);
  }
};
