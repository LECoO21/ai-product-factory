import { describe, expect, it, vi } from "vitest";
import { CodexAccountService } from "./codex-account";
import type { CodexAppServerClient } from "./codex-app-server-client";

describe("CodexAccountService", () => {
  it("starts the official managed ChatGPT browser login flow", async () => {
    const request = vi.fn(async () => ({
      type: "chatgpt",
      loginId: "login-1",
      authUrl: "https://auth.openai.com/codex"
    }));
    const service = new CodexAccountService({ request } as unknown as CodexAppServerClient);

    await expect(service.startChatGptLogin()).resolves.toEqual({
      loginId: "login-1",
      authUrl: "https://auth.openai.com/codex"
    });
    expect(request).toHaveBeenCalledWith("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt"
    });
  });

  it("reads image-generation support from the App Server provider contract", async () => {
    const request = vi.fn(async () => ({
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true
    }));
    const service = new CodexAccountService({ request } as unknown as CodexAppServerClient);

    await expect(service.readProviderCapabilities()).resolves.toEqual({
      namespaceTools: true,
      imageGeneration: true,
      webSearch: true
    });
    expect(request).toHaveBeenCalledWith("modelProvider/capabilities/read", {});
  });
});
