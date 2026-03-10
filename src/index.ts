/**
 * Qwen OAuth Plugin for OpenCode
 * Clean architecture with separated concerns
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { QWEN_API_BASE_URL } from "./constants.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken } from "./strategies/oauth.strategy.js";
import { tokenService } from "./services/token.service.js";
import { credentialRepository } from "./repositories/credential.repository.js";
import { createAuthMiddleware } from "./middleware/auth.middleware.js";
import { setLoggerClient } from "./utils/logger.js";
import { Mutex } from "./utils/mutex.js";
import { getConfig } from "./config.js";

const PLUGIN_VERSION = "2.3.1";

export const QwenOAuthPlugin: Plugin = async ({ client, directory, worktree, project }: PluginInput) => {
  setLoggerClient({
    app: {
      log: async (entry: any) => {
        try {
          await client.app.log(entry);
        } catch {
          console.log(`[${entry.body.level}] ${entry.body.message}`, entry.body.extra || "");
        }
      },
    },
  });

  const config = getConfig();
  const authMutex = new Mutex();

  const debugLog = (message: string, data?: Record<string, unknown>) =>
    client.app.log({ body: { service: "qwen-oauth", level: "debug", message, extra: data } }).catch(() => {});

  debugLog("Plugin initialized", { directory, worktree, project: (project as any)?.name || "N/A" });

  return {
    auth: {
      provider: "qwen",
      async loader(getAuth, provider) {
        let auth = await getAuth();

        if (!auth || auth.type !== "oauth" || !auth.access) {
          const fileCreds = credentialRepository.load();
          if (fileCreds) {
            auth = {
              type: "oauth",
              access: fileCreds.accessToken,
              refresh: fileCreds.refreshToken,
              expires: fileCreds.expiryDate,
            };
            tokenService.setCachedAuth(auth);
          }
        }

        if (!auth || auth.type !== "oauth") return {};

        tokenService.setCachedAuth(auth as any);
        const authMiddleware = createAuthMiddleware({ platform: process.platform, arch: process.arch });

        return {
          apiKey: "",
          fetch: authMiddleware,
        };
      },
      methods: [
        {
          type: "oauth",
          label: "Qwen Code (qwen.ai OAuth)",
          authorize: async () => {
            if (authMutex.isLocked()) {
              throw new Error("Authorization already in progress");
            }

            return authMutex.runExclusive(async () => {
              debugLog("Starting Qwen OAuth device flow...");

              const device = await authorizeDevice();
              const url = device.verification_uri_complete || device.verification_uri;
              openBrowser(url);

              return {
                url,
                instructions: `Enter code: ${device.user_code}`,
                method: "auto",
                callback: async () => {
                  debugLog("Polling for OAuth token...");

                  const result = await pollForToken(
                    device.device_code,
                    device.verifier,
                    device.interval,
                    device.expires_in,
                  );

                  if (result.success) {
                    const expiresIn = result.expires_in || 0;
                    const expires = expiresIn > 0 ? Date.now() + expiresIn * 1000 : Date.now() + 21600 * 1000;

                    const authResult = {
                      type: "oauth",
                      refresh: result.refresh_token || "",
                      access: result.access_token || "",
                      expires,
                      apiKey: result.api_key,
                    } as any;

                    tokenService.setCachedAuth(authResult);
                    credentialRepository.save({
                      accessToken: result.access_token || "",
                      refreshToken: result.refresh_token || "",
                      expiryDate: expires,
                      tokenType: "Bearer",
                    });

                    debugLog("Qwen authentication successful!", {
                      expires_in: result.expires_in,
                      has_refresh: !!result.refresh_token,
                      has_api_key: !!result.api_key,
                    });

                    return authResult;
                  }

                  debugLog(`Authentication failed: ${result.error}`);
                  return { type: "failed", error: result.error! };
                },
              };
            });
          },
        },
      ],
    },
    config: async (cfg: Record<string, unknown>) => {
      const providers = (cfg.provider as Record<string, unknown>) || {};
      cfg.provider = providers;
      providers["qwen"] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Qwen Code",
        options: { baseURL: QWEN_API_BASE_URL },
        models: {
          "coder-model": {
            id: "coder-model",
            name: "Qwen Coder",
            limit: { context: 1048576, output: 65536 },
            modalities: { input: ["text"], output: ["text"] },
          },
          "vision-model": {
            id: "vision-model",
            name: "Qwen Vision",
            limit: { context: 131072, output: 32768 },
            modalities: { input: ["text", "image"], output: ["text"] },
            attachment: true,
          },
        },
      };
    },
    event: async ({ event }) => {
      if (event.type === "session.error") {
        debugLog("Session error occurred", { timestamp: new Date().toISOString() });
      }
    },
    "chat.headers": async (input, output) => {
      const providerId = (input.provider as any)?.info?.id || (input.provider as any)?.id;
      if (providerId === "qwen" || providerId === "qwen-code") {
        const userAgent = `QwenCode/${PLUGIN_VERSION} (${process.platform}; ${process.arch})`;
        output.headers["User-Agent"] = userAgent;
        output.headers["X-DashScope-CacheControl"] = "enable";
        output.headers["X-DashScope-UserAgent"] = userAgent;
        output.headers["X-DashScope-AuthType"] = "qwen-oauth";
      }
    },
    "chat.params": async (input, output) => {
      const providerId = (input.provider as any)?.info?.id || (input.provider as any)?.id;
      if (providerId === "qwen" || providerId === "qwen-code") {
        output.temperature = output.temperature ?? 0.7;
        output.topP = output.topP ?? 0.95;
      }
    },
    "shell.env": async (input, output) => {
      output.env.QWEN_API_BASE_URL = QWEN_API_BASE_URL;
      output.env.QWEN_PROVIDER = "qwen";
    },
  };
};

export default QwenOAuthPlugin;
