import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError } from "@/lib/api/server-error";
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifyInviteCode
} from "@/lib/auth/session";

const loginSchema = z.object({ inviteCode: z.string().trim().min(1).max(200) });

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_INVITE_CODE", "请输入邀请码", 400);
  try {
    if (!verifyInviteCode(parsed.data.inviteCode)) {
      return apiError("INVALID_INVITE_CODE", "邀请码不正确", 401);
    }
    const response = NextResponse.json({ authenticated: true });
    response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), sessionCookieOptions());
    return response;
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "auth.configuration_failed", errorType: error instanceof Error ? error.name : "unknown" }));
    return apiError("AUTH_NOT_CONFIGURED", "登录服务尚未配置", 503);
  }
}
