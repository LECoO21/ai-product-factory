import { CodexAppServerClient } from "./codex-app-server-client";

export type CodexAccount =
  | { type: "chatgpt"; email: string | null; planType: string }
  | { type: "apiKey" }
  | { type: "amazonBedrock"; usesCodexManagedCredentials: boolean };

export type CodexAccountSnapshot = {
  authenticated: boolean;
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

type AccountReadResponse = {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
};

type LoginStartResponse =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: string; [key: string]: unknown };

export type CodexSkill = {
  name: string;
  enabled: boolean;
  description?: string;
  dependencies?: { tools?: Array<{ type: string; value: string }> };
};

export type CodexProviderCapabilities = {
  namespaceTools: boolean;
  imageGeneration: boolean;
  webSearch: boolean;
};

type SkillsListResponse = {
  data: Array<{ cwd: string; skills: CodexSkill[]; errors: Array<{ path: string; message: string }> }>;
};

export class CodexAccountService {
  constructor(private readonly client: CodexAppServerClient) {}

  async read(refreshToken = false): Promise<CodexAccountSnapshot> {
    const result = await this.client.request<AccountReadResponse>("account/read", { refreshToken });
    return {
      authenticated: result.account?.type === "chatgpt",
      account: result.account,
      requiresOpenaiAuth: result.requiresOpenaiAuth
    };
  }

  async startChatGptLogin() {
    const result = await this.client.request<LoginStartResponse>("account/login/start", {
      type: "chatgpt",
      useHostedLoginSuccessPage: true,
      appBrand: "chatgpt"
    });
    if (result.type !== "chatgpt" || typeof result.loginId !== "string" || typeof result.authUrl !== "string") {
      throw new Error("Codex 未返回可用的 ChatGPT 登录地址");
    }
    return { loginId: result.loginId, authUrl: result.authUrl };
  }

  async cancelLogin(loginId: string) {
    await this.client.request("account/login/cancel", { loginId });
  }

  async logout() {
    await this.client.request("account/logout");
  }

  async listSkills(cwd: string) {
    const result = await this.client.request<SkillsListResponse>("skills/list", {
      cwds: [cwd],
      forceReload: false
    });
    return result.data.flatMap((entry) => entry.skills);
  }

  async readProviderCapabilities(): Promise<CodexProviderCapabilities> {
    return this.client.request<CodexProviderCapabilities>(
      "modelProvider/capabilities/read",
      {}
    );
  }
}
