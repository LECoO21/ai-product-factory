import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function apiError(
  code: string,
  userMessage: string,
  status: number,
  options: { retryable?: boolean; fieldErrors?: Record<string, string[]> } = {}
) {
  return NextResponse.json(
    {
      error: {
        code,
        userMessage,
        retryable: options.retryable ?? status >= 500,
        requestId: randomUUID(),
        ...(options.fieldErrors ? { fieldErrors: options.fieldErrors } : {})
      }
    },
    { status }
  );
}
