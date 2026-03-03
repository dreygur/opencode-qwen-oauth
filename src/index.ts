/**
 * Qwen OAuth Plugin for OpenCode
 * Provides OAuth device flow authentication for Qwen.ai
 *
 * @packageDocumentation
 */

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ============================================
// Constants
// ============================================

const QWEN_OAUTH_BASE_URL = "https://chat.qwen.ai";
const QWEN_DEVICE_CODE_ENDPOINT = "/api/v1/oauth2/device/code";
const QWEN_TOKEN_ENDPOINT = "/api/v1/oauth2/token";
const QWEN_CLIENT_ID = "f0304373b74a44d2b584a3fb70ca9e56";
const QWEN_SCOPES = ["openid", "profile", "email", "model.completion"];
const QWEN_API_BASE_URL = "https://portal.qwen.ai/v1";

// ============================================
// Logging
// ============================================

function getLogDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode", "logs");
}

function getLogFilePath(): string {
  return join(getLogDir(), "qwen-oauth.log");
}

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
}

function writeLog(message: string): void {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    appendFileSync(getLogFilePath(), logLine, { encoding: "utf-8" });
  } catch {
    // Silently ignore log write errors
  }
}

const DEBUG =
  process.env.QWEN_OAUTH_DEBUG === "true" ||
  process.env.QWEN_OAUTH_DEBUG === "1";

function debugLog(message: string, data?: Record<string, unknown>): void {
  const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
  writeLog(logMessage);
}

// ============================================
// PKCE
// ============================================

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier).digest(),
  );
  return { verifier, challenge };
}

// ============================================
// Browser
// ============================================

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    const command =
      platform === "darwin"
        ? "open"
        : platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const args =
      platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
    const child = spawn(command, args, {
      stdio: "ignore",
      detached: true,
    });
    child.unref?.();
  } catch {
    // Ignore errors
  }
}

// ============================================
// OAuth Device Flow
// ============================================

interface DeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
  verifier: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval?: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

async function authorizeDevice(): Promise<DeviceAuthorization> {
  const { verifier, challenge } = createPkcePair();

  const params = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const response = await fetch(
    `${QWEN_OAUTH_BASE_URL}${QWEN_DEVICE_CODE_ENDPOINT}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to start device flow: ${response.statusText}`);
  }

  const data = (await response.json()) as DeviceCodeResponse;
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    verification_uri_complete: data.verification_uri_complete,
    expires_in: data.expires_in,
    interval: data.interval || 5,
    verifier,
  };
}

async function pollForToken(
  deviceCode: string,
  codeVerifier: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<{
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}> {
  const timeoutMs = expiresIn * 1000;
  const startTime = Date.now();
  let currentInterval = intervalSeconds * 1000;

  debugLog("Starting token polling", { timeoutMs, interval: currentInterval });

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval));

    const params = new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      code_verifier: codeVerifier,
    });

    debugLog("Polling for token...");

    const response = await fetch(
      `${QWEN_OAUTH_BASE_URL}${QWEN_TOKEN_ENDPOINT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    if (response.ok) {
      const data = (await response.json()) as TokenResponse;
      debugLog("Token received successfully");
      return {
        success: true,
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
      };
    }

    const error = (await response.json().catch(() => ({}))) as {
      error?: string;
      error_description?: string;
    };

    if (error.error === "authorization_pending") {
      debugLog("Authorization pending, retrying...");
      continue;
    }

    if (error.error === "slow_down") {
      currentInterval += 5000;
      debugLog("Server requested slow down, new interval:", {
        interval: currentInterval,
      });
      continue;
    }

    if (error.error === "expired_token") {
      debugLog("Device code expired");
      return {
        success: false,
        error: "Device code expired. Please try again.",
      };
    }

    debugLog(
      `Token polling failed: ${error.error_description || "unknown error"}`,
    );
    return {
      success: false,
      error: error.error_description || "Authentication failed",
    };
  }

  debugLog("Polling timeout exceeded");
  return { success: false, error: "Polling timeout - device code expired" };
}

// ============================================
// Plugin
// ============================================

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
