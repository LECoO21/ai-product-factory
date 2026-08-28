import type { Instrumentation } from "next";

declare global {
  var __factoryProductionRuntimeStarted: boolean | undefined;
  var __factorySentryStarted: boolean | undefined;
}

async function startSentry() {
  if (!process.env.SENTRY_DSN?.trim() || globalThis.__factorySentryStarted) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.ENV?.trim() || process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
        }
      }
      return event;
    }
  });
  globalThis.__factorySentryStarted = true;
}

export async function registerNodeRuntime() {
  await startSentry();
  if (
    process.env.FACTORY_EMBED_WORKER?.trim() !== "true" ||
    globalThis.__factoryProductionRuntimeStarted
  ) return;

  globalThis.__factoryProductionRuntimeStarted = true;
  const { logEvent } = await import("./lib/observability/log");
  const {
    restoreFactoryDatabaseIfMissing,
    startFactoryBackupScheduler
  } = await import("@factory/records");

  try {
    const restore = await restoreFactoryDatabaseIfMissing();
    logEvent("info", "backup.restore_checked", {
      status: restore.status,
      reason: restore.reason,
      sha256: restore.sha256
    });
  } catch (error) {
    globalThis.__factoryProductionRuntimeStarted = false;
    logEvent("error", "backup.restore_failed", {
      errorType: error instanceof Error ? error.name : "unknown"
    });
    throw error;
  }

  const backup = startFactoryBackupScheduler({
    onResult: (result) => logEvent("info", "backup.completed", {
      status: result.status,
      reason: result.reason,
      artifactCount: result.artifactCount,
      sha256: result.sha256
    }),
    onError: (error) => logEvent("error", "backup.failed", {
      errorType: error instanceof Error ? error.name : "unknown"
    })
  });
  const { startFactoryWorker, stopFactoryWorker } = await import("@factory/worker");
  void startFactoryWorker().catch((error) => {
    logEvent("error", "worker.fatal", {
      errorType: error instanceof Error ? error.name : "unknown"
    });
  });
  const stop = () => {
    backup.stop();
    stopFactoryWorker();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  logEvent("info", "production_runtime.started");
}

export async function captureNodeRequestError(
  error: unknown,
  request: Parameters<Instrumentation.onRequestError>[1],
  context: Parameters<Instrumentation.onRequestError>[2]
) {
  const { logEvent } = await import("./lib/observability/log");
  logEvent("error", "request.unhandled_error", {
    path: request.path,
    method: request.method,
    routePath: context.routePath,
    routeType: context.routeType,
    errorType: error instanceof Error ? error.name : "unknown"
  });
  if (process.env.SENTRY_DSN?.trim()) {
    await startSentry();
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, request, context);
  }
}
