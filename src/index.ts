/**
 * Qwen OAuth Plugin for OpenCode
 * Provides OAuth device flow authentication for Qwen.ai
 * With proactive token refresh via custom fetch loader
 *
 * @packageDocumentation
 */

const PLUGIN_VERSION = "2.2.0";

type RequestInfoType = Request | URL | string;

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { QWEN_API_BASE_URL } from "./constants.js";
import { debugLog, warnLog } from "./logger.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken, refreshAccessToken } from "./oauth.js";
import { Mutex } from "./mutex.js";
import { getConfig } from "./config.js";

interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access: string;
  expires?: number;
}

const authorizationMutex = new Mutex();
const tokenRefreshMutex = new Mutex();

let cachedAuth: OAuthAuthDetails | null = null;

type GetAuth = () => Promise<any>;

export const QwenOAuthPlugin: Plugin = async ({
  project,
  client,
  directory,
  worktree,
}: PluginInput) => {
  debugLog("Plugin initialized", {
    directory,
    worktree,
    project: (project as any)?.name || "N/A",
  });

  const config = getConfig();

  return {
    auth: {
      provider: "qwen",
      async loader(getAuth: GetAuth, provider) {
        const auth = await getAuth();
        
        if (!auth || auth.type !== "oauth") {
          return {};
        }

        cachedAuth = auth;

        const refreshTokenIfNeeded = async (): Promise<OAuthAuthDetails> => {
          if (!cachedAuth) {
            throw new Error("No authentication available");
          }

          const now = Date.now();
          const expiresAt = cachedAuth.expires || 0;
          const timeUntilExpiry = expiresAt - now;
          
          const shouldRefresh = 
            !cachedAuth.access ||
            timeUntilExpiry < config.refreshThreshold;

          if (!shouldRefresh) {
            return cachedAuth;
          }

          debugLog("Token refresh needed", {
            hasAccess: !!cachedAuth.access,
            expiresAt: new Date(expiresAt).toISOString(),
            timeUntilExpiry,
            refreshThreshold: config.refreshThreshold,
          });

          return tokenRefreshMutex.runExclusive(async () => {
            const currentAuth = cachedAuth;
            if (!currentAuth || !currentAuth.refresh) {
              throw new Error("No refresh token available");
            }

            const result = await refreshAccessToken(currentAuth.refresh);

            if (result.success && result.access_token) {
              const newAuth: OAuthAuthDetails = {
                type: "oauth",
                refresh: result.refresh_token || currentAuth.refresh,
                access: result.access_token,
                expires: Date.now() + (result.expires_in || 0) * 1000,
              };

              cachedAuth = newAuth;

              try {
                await client.auth.set({
                  path: { id: "qwen" },
                  body: newAuth as any,
                });
                debugLog("Token refreshed and stored", {
                  expires: newAuth.expires,
                });
              } catch (storeError) {
                debugLog("Failed to store refreshed token", {
                  error: String(storeError),
                });
              }

              return newAuth;
            }

            debugLog("Token refresh failed", { error: result.error });
            throw new Error(result.error || "Token refresh failed");
          });
        };

        return {
          apiKey: "",
          async fetch(
            input: RequestInfoType,
            init?: RequestInit,
          ): Promise<Response> {
            let auth = await refreshTokenIfNeeded();
            const maxRetries = 2;
            let lastResponse: Response | null = null;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              let url: string;
              if (typeof input === "string") {
                url = input;
              } else if (input instanceof URL) {
                url = input.toString();
              } else {
                url = (input as Request).url;
              }

              const headers = new Headers(init?.headers);
              if (auth.access) {
                headers.set("Authorization", `Bearer ${auth.access}`);
              }

              const response = await fetch(url, {
                ...init,
                headers,
              });

              lastResponse = response;

              if (response.status === 401 && attempt < maxRetries) {
                debugLog("Received 401, attempting token refresh", { attempt });

                const refreshedAuth = await tokenRefreshMutex.runExclusive(async () => {
                  const currentAuth = cachedAuth;
                  if (!currentAuth || !currentAuth.refresh) {
                    throw new Error("No refresh token available");
                  }

                  const result = await refreshAccessToken(currentAuth.refresh);

                  if (result.success && result.access_token) {
                    const newAuth: OAuthAuthDetails = {
                      type: "oauth",
                      refresh: result.refresh_token || currentAuth.refresh,
                      access: result.access_token,
                      expires: Date.now() + (result.expires_in || 0) * 1000,
                    };

                    cachedAuth = newAuth;

                    try {
                      await client.auth.set({
                        path: { id: "qwen" },
                        body: newAuth as any,
                      });
                    } catch (storeError) {
                      debugLog("Failed to store refreshed token after 401", {
                        error: String(storeError),
                      });
                    }

                    return newAuth;
                  }

                  debugLog("Token refresh failed after 401", { error: result.error });
                  return null;
                });

                if (refreshedAuth) {
                  auth = refreshedAuth;
                  debugLog("Retrying request with refreshed token", { attempt: attempt + 1 });
                  continue;
                } else {
                  debugLog("Token refresh failed, returning 401");
                  break;
                }
              }

              return response;
            }

            return lastResponse!;
          },
        };
      },
      methods: [
        {
          type: "oauth",
          label: "Qwen Code (qwen.ai OAuth)",
          authorize: async () => {
            if (authorizationMutex.isLocked()) {
              warnLog("Authorization already in progress");
              throw new Error(
                "Authorization already in progress. Please wait for the current flow to complete.",
              );
            }

            return authorizationMutex.runExclusive(async () => {
              debugLog("Starting Qwen OAuth device flow...");

              const device = await authorizeDevice();
              const url =
                device.verification_uri_complete || device.verification_uri;

              openBrowser(url);

              debugLog("Device authorization received", {
                user_code: device.user_code,
                verification_uri: device.verification_uri,
                expires_in: device.expires_in,
                interval: device.interval,
              });

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
                    const authResult: OAuthAuthDetails = {
                      type: "oauth",
                      refresh: result.refresh_token!,
                      access: result.access_token || "",
                      expires: Date.now() + (result.expires_in || 0) * 1000,
                    };

                    cachedAuth = authResult;

                    debugLog("Qwen authentication successful!", {
                      expires_in: result.expires_in,
                      has_refresh: !!result.refresh_token,
                    });

                    return {
                      type: "success",
                      refresh: result.refresh_token!,
                      access: result.access_token!,
                      expires: Date.now() + result.expires_in! * 1000,
                    };
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
    config: async (config: Record<string, unknown>) => {
      const providers =
        (config.provider as Record<string, unknown> & {
          [key: string]: unknown;
        }) || {};
      config.provider = providers;
      providers["qwen"] = {
        npm: "@ai-sdk/openai-compatible",
        name: "Qwen Code",
        options: {
          baseURL: QWEN_API_BASE_URL,
        },
        models: {
          "qwen3-coder-plus": {
            id: "qwen3-coder-plus",
            name: "Qwen3 Coder Plus",
          },
          "qwen3-vl-plus": {
            id: "qwen3-vl-plus",
            name: "Qwen3 VL Plus",
            attachment: true,
          },
        },
      };
    },

    event: async ({ event }) => {
      if (event.type === "session.error") {
        debugLog("Session error occurred", {
          type: event.type,
          timestamp: new Date().toISOString(),
        });
      }

      if (event.type === "session.created") {
        debugLog("New session created", {
          type: event.type,
          timestamp: new Date().toISOString(),
        });
      }
    },

    "chat.headers": async (input, output) => {
      if (input.provider.info.id === "qwen") {
        debugLog("Adding custom headers for Qwen request", {
          model: input.model.id,
          session: input.sessionID,
        });

        output.headers["X-Qwen-Client"] = "OpenCode";
        output.headers["X-Qwen-Plugin-Version"] = PLUGIN_VERSION;
      }
    },

    "chat.params": async (input, output) => {
      if (input.provider.info.id === "qwen") {
        debugLog("Customizing parameters for Qwen model", {
          model: input.model.id,
          current_temp: output.temperature,
        });

        if (output.temperature === undefined) {
          output.temperature = 0.7;
        }
        if (output.topP === undefined) {
          output.topP = 0.95;
        }
      }
    },

    "shell.env": async (input, output) => {
      debugLog("Setting up shell environment", {
        cwd: input.cwd,
        hasSession: !!input.sessionID,
      });

      output.env.QWEN_API_BASE_URL = QWEN_API_BASE_URL;
      output.env.QWEN_PROVIDER = "qwen";
    },
  };
};

export default QwenOAuthPlugin;
