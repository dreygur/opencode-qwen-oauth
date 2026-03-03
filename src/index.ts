/**
 * Qwen OAuth Plugin for OpenCode
 * Provides OAuth device flow authentication for Qwen.ai
 *
 * @packageDocumentation
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { QWEN_API_BASE_URL } from "./constants.js";
import { debugLog } from "./logger.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken } from "./oauth.js";

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
  };
};

export default QwenOAuthPlugin;
