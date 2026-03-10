/**
 * OAuth Device Flow strategy
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628)
 */

import {
  QWEN_OAUTH_BASE_URL,
  QWEN_DEVICE_CODE_ENDPOINT,
  QWEN_TOKEN_ENDPOINT,
  QWEN_CLIENT_ID,
  QWEN_SCOPES,
} from "../constants.js";
import { createPkcePair } from "../utils/pkce.js";
import { fetchWithRetry } from "../middleware/retry.middleware.js";
import { getConfig } from "../config.js";
import {
  validateDeviceCode,
  validateUserCode,
  validateToken,
  validateExpiresIn,
  validateInterval,
  validateQwenUrl,
  validateOAuthError,
} from "../validation.js";
import { debugLog, warnLog, infoLog } from "../utils/logger.js";
import { DeviceAuthorization, TokenResponse } from "../types.js";

const activePollingOperations = new Set<string>();

export async function authorizeDevice(): Promise<DeviceAuthorization> {
  const config = getConfig();
  const { verifier, challenge } = createPkcePair();

  const params = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  try {
    const response = await fetchWithRetry(
      `${QWEN_OAUTH_BASE_URL}${QWEN_DEVICE_CODE_ENDPOINT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
      {
        maxRetries: config.maxRetries,
        baseDelay: config.baseRetryDelay,
        maxDelay: config.maxRetryDelay,
        timeout: config.timeout,
      },
    );

    const data = (await response.json()) as Record<string, unknown>;

    validateDeviceCode(String(data.device_code));
    validateUserCode(String(data.user_code));

    const expiresIn = validateExpiresIn(
      typeof data.expires_in === "number" ? data.expires_in : undefined,
      300,
    );
    const interval = validateInterval(
      typeof data.interval === "number" ? data.interval : undefined,
    );

    if (!validateQwenUrl(String(data.verification_uri))) {
      throw new Error("Invalid verificationURI received from server");
    }

    debugLog("Device authorization successful", {
      user_code: String(data.user_code),
      expires_in: data.expires_in,
    });

    return {
      device_code: String(data.device_code),
      user_code: String(data.user_code),
      verification_uri: String(data.verification_uri),
      verification_uri_complete: String(data.verification_uri_complete),
      expires_in: expiresIn,
      interval,
      verifier,
    };
  } catch (error) {
    debugLog("Device authorization failed", { error: String(error) });
    throw new Error(`Failed to start device flow: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function pollForToken(
  deviceCode: string,
  codeVerifier: string,
  intervalSeconds: number,
  expiresIn: number,
): Promise<TokenResponse> {
  try {
    validateDeviceCode(deviceCode);
    intervalSeconds = validateInterval(intervalSeconds);
    expiresIn = validateExpiresIn(expiresIn);
  } catch (error) {
    debugLog("Invalid polling parameters", { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid parameters",
    };
  }

  if (activePollingOperations.has(deviceCode)) {
    warnLog("Polling already in progress for this device code");
    return {
      success: false,
      error: "Authorization already in progress",
    };
  }

  activePollingOperations.add(deviceCode);

  const timeoutMs = expiresIn * 1000;
  const startTime = Date.now();
  let currentInterval = intervalSeconds * 1000;
  let pollAttempts = 0;

  const cleanup = () => activePollingOperations.delete(deviceCode);

  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval));
    pollAttempts++;

    const params = new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      code_verifier: codeVerifier,
    });

    debugLog(`Polling attempt ${pollAttempts}...`);

    try {
      const response = await fetch(`${QWEN_OAUTH_BASE_URL}${QWEN_TOKEN_ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });

      if (response.ok) {
        const data = (await response.json()) as Record<string, unknown>;

        infoLog("OAuth token received", {
          hasAccessToken: !!data.access_token,
          hasRefreshToken: !!data.refresh_token,
          hasApiKey: !!data.api_key,
        });

        try {
          validateToken(String(data.access_token));
          if (data.refresh_token) validateToken(String(data.refresh_token));
          if (data.api_key) validateToken(String(data.api_key));

          const expiresIn = validateExpiresIn(
            typeof data.expires_in === "number" ? data.expires_in : undefined,
            3600,
          );

          cleanup();
          return {
            success: true,
            access_token: String(data.access_token),
            refresh_token: data.refresh_token ? String(data.refresh_token) : undefined,
            expires_in: expiresIn,
            api_key: data.api_key ? String(data.api_key) : undefined,
          };
        } catch (validationError) {
          debugLog("Invalid token response", { error: String(validationError) });
          cleanup();
          return {
            success: false,
            error: "Received invalid token from server",
          };
        }
      }

      const errorData = await response.json().catch(() => ({}));
      const oauthError = validateOAuthError(errorData);

      if (oauthError.error === "authorization_pending") {
        continue;
      }

      if (oauthError.error === "slow_down") {
        currentInterval += 5000;
        continue;
      }

      if (oauthError.error === "expired_token") {
        cleanup();
        return {
          success: false,
          error: "Device code expired. Please run '/connect' again.",
        };
      }

      if (oauthError.error === "access_denied") {
        cleanup();
        return {
          success: false,
          error: "Authorization was denied",
        };
      }

      cleanup();
      return {
        success: false,
        error: oauthError.error_description || oauthError.error,
      };
    } catch (error) {
      debugLog("Network error during polling", { error: String(error) });
      if (Date.now() - startTime >= timeoutMs) {
        cleanup();
        return {
          success: false,
          error: "Network error occurred during authentication",
        };
      }
    }
  }

  cleanup();
  return { success: false, error: "Polling timeout - device code expired" };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  try {
    validateToken(refreshToken);
  } catch (error) {
    return { success: false, error: "Invalid refresh token" };
  }

  const config = getConfig();

  try {
    const params = new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    debugLog("Refreshing access token");

    const response = await fetchWithRetry(
      `${QWEN_OAUTH_BASE_URL}${QWEN_TOKEN_ENDPOINT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
      {
        maxRetries: config.maxRetries,
        timeout: config.timeout,
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const oauthError = validateOAuthError(errorData);

      debugLog("OAuth error during token refresh", {
        status: response.status,
        error: oauthError.error,
      });

      if (oauthError.error === "invalid_grant") {
        return {
          success: false,
          error: "Your refresh token has expired. Please run '/connect' to re-authenticate.",
        };
      }

      if (oauthError.error === "invalid_client") {
        return {
          success: false,
          error: "OAuth client configuration error.",
        };
      }

      return {
        success: false,
        error: oauthError.error_description || oauthError.error || "Token refresh failed",
      };
    }

    const data = (await response.json()) as Record<string, unknown>;

    validateToken(String(data.access_token));
    if (data.api_key) validateToken(String(data.api_key));

    const expiresIn = validateExpiresIn(
      typeof data.expires_in === "number" ? data.expires_in : undefined,
      3600,
    );
    const newRefreshToken = data.refresh_token ? String(data.refresh_token) : refreshToken;

    debugLog("Token refresh successful", {
      new_refresh_token: !!data.refresh_token,
      has_api_key: !!data.api_key,
    });

    return {
      success: true,
      access_token: String(data.access_token),
      refresh_token: newRefreshToken,
      expires_in: expiresIn,
      api_key: data.api_key ? String(data.api_key) : undefined,
    };
  } catch (error) {
    debugLog("Token refresh failed", { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Token refresh failed",
    };
  }
}
