import { z } from "zod";
import { requestJson } from "@/lib/api/client";

export const login = (inviteCode: string) =>
  requestJson("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
    schema: z.object({ authenticated: z.literal(true) })
  });

export const logout = () =>
  requestJson("/api/auth/logout", {
    method: "POST",
    schema: z.object({ authenticated: z.literal(false) })
  });
