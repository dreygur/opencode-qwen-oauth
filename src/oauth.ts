/**
 * OAuth Device Flow implementation for Qwen
 */

import {
  QWEN_OAUTH_BASE_URL,
  QWEN_DEVICE_CODE_ENDPOINT,
  QWEN_TOKEN_ENDPOINT,
  QWEN_CLIENT_ID,
  QWEN_SCOPES,
} from "./constants.js";
import { createPkcePair } from "./pkce.js";
import { debugLog } from "./logger.js";

export interface DeviceAuthorization {
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

export async function authorizeDevice(): Promise<DeviceAuthorization> {
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

export async function pollForToken(
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
