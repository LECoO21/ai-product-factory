import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  isFactoryAuthenticationRequired,
  SESSION_COOKIE_NAME,
  verifySessionToken
} from "./lib/auth/session";

const publicPath = (pathname: string) =>
  pathname === "/login" ||
  pathname === "/api/auth/login" ||
  pathname === "/api/auth/logout" ||
  pathname === "/api/health" ||
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico";

export async function proxy(request: NextRequest) {
  const traceId = request.headers.get("x-trace-id") || randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-trace-id", traceId);

  if (isFactoryAuthenticationRequired() && !publicPath(request.nextUrl.pathname)) {
    const session = verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);
    if (!session) {
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: { code: "AUTH_REQUIRED", userMessage: "请先登录", retryable: false, requestId: traceId } },
          { status: 401, headers: { "x-trace-id": traceId } }
        );
      }
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(loginUrl, { headers: { "x-trace-id": traceId } });
    }
    requestHeaders.set("x-factory-user-id", session.subject);
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("x-trace-id", traceId);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "same-origin");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp)$).*)"]
};
