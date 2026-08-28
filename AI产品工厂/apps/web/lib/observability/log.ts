export type LogLevel = "info" | "warn" | "error";

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}) {
  const safeFields = Object.fromEntries(
    Object.entries(fields).filter(([key]) =>
      !/(secret|token|cookie|authorization|invite|prompt|manual|content)/i.test(key)
    )
  );
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event,
    ...safeFields
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
