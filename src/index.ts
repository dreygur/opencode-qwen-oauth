/**
 * Qwen OAuth Plugin for OpenCode
 * Provides OAuth device flow authentication for Qwen.ai
 *
 * @packageDocumentation
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { QWEN_API_BASE_URL } from "./constants.js";
import { debugLog, warnLog } from "./logger.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken } from "./oauth.js";
import { Mutex } from "./mutex.js";

// Mutex to prevent multiple concurrent authorization flows
const authorizationMutex = new Mutex();

export const QwenOAuthPlugin: Plugin = async ({
  project,
  client,
  $,
  directory,
  worktree,
}: PluginInput) => {
  debugLog("Plugin initialized", {
    directory,
    worktree,
    project: (project as any)?.name || "N/A",
  });

  return {
    auth: {
      provider: "qwen",
      methods: [
        {
          type: "oauth",
          label: "Qwen Code (qwen.ai OAuth)",
          authorize: async () => {
            // Check if authorization is already in progress
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

              // Try to open browser automatically
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
                  debugLog("Qwen authentication successful!", {
                    expires_in: result.expires_in,
                    has_refresh: !!result.refresh_token,
                  });
                  return {
                    type: "success",
                    access: result.access_token!,
                    refresh: result.refresh_token!,
                    expires: Date.now() + result.expires_in! * 1000,
                  };
                }

                debugLog(`Authentication failed: ${result.error}`);
                return { type: "failed", error: result.error! };
              },
            };
            }); // End runExclusive
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

    // Event monitoring hook
    event: async ({ event }) => {
      // Log important events for debugging
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

    // Inject custom headers for Qwen API requests
    "chat.headers": async (input, output) => {
      // Only add headers for Qwen provider
      if (input.provider.info.id === "qwen") {
        debugLog("Adding custom headers for Qwen request", {
          model: input.model.id,
          session: input.sessionID,
        });

        // Add any custom headers needed for Qwen
        // OpenCode will automatically handle the Authorization header
        output.headers["X-Qwen-Client"] = "OpenCode";
        output.headers["X-Qwen-Plugin-Version"] = "1.1.0";
      }
    },

    // Customize model parameters for Qwen
    "chat.params": async (input, output) => {
      if (input.provider.info.id === "qwen") {
        debugLog("Customizing parameters for Qwen model", {
          model: input.model.id,
          current_temp: output.temperature,
        });

        // Qwen models work well with these defaults
        // Users can override these in their config
        if (output.temperature === undefined) {
          output.temperature = 0.7;
        }
        if (output.topP === undefined) {
          output.topP = 0.95;
        }
      }
    },

    // Expose Qwen credentials as environment variables if needed
    "shell.env": async (input, output) => {
      debugLog("Setting up shell environment", {
        cwd: input.cwd,
        hasSession: !!input.sessionID,
      });

      // Add Qwen-specific environment variables
      output.env.QWEN_API_BASE_URL = QWEN_API_BASE_URL;
      output.env.QWEN_PROVIDER = "qwen";
    },
  };
};

export default QwenOAuthPlugin;
