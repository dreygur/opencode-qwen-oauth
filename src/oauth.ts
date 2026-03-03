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
import { fetchWithRetry } from "./retry.js";
import {
  DeviceFlowError,
  NetworkError,
  TokenExpiredError,
  RateLimitError,
} from "./errors.js";
import {
  validateDeviceCode,
  validateUserCode,
  validateToken,
  validateExpiresIn,
  validateInterval,
  validateQwenUrl,
  validateOAuthError,
} from "./validation.js";
import { getConfig } from "./config.js";

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
  const config = getConfig();
  const { verifier, challenge } = createPkcePair();

  const params = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  try {
    const url = `${QWEN_OAUTH_BASE_URL}${QWEN_DEVICE_CODE_ENDPOINT}`;
    debugLog("Requesting device authorization", { url });

    const response = await fetchWithRetry(
      url,
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

    const data = (await response.json()) as DeviceCodeResponse;

    // Validate response data
    validateDeviceCode(data.device_code);
    validateUserCode(data.user_code);
    validateExpiresIn(data.expires_in);
    
    const interval = data.interval || 5;
    validateInterval(interval);

    // Validate URLs
    if (!validateQwenUrl(data.verification_uri)) {
      throw new DeviceFlowError(
        "Invalid verification URI received from server",
      );
    }

    debugLog("Device authorization successful", {
      user_code: data.user_code,
      expires_in: data.expires_in,
    });

    return {
      device_code: data.device_code,
      user_code: data.user_code,
      verification_uri: data.verification_uri,
      verification_uri_complete: data.verification_uri_complete,
      expires_in: data.expires_in,
      interval,
      verifier,
    };
  } catch (error) {
    debugLog("Device authorization failed", { error: String(error) });
    
    if (error instanceof DeviceFlowError || error instanceof NetworkError) {
      throw error;
    }
    
    throw new DeviceFlowError(
      `Failed to start device flow: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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
  // Validate inputs
  try {
    validateDeviceCode(deviceCode);
    validateInterval(intervalSeconds);
    validateExpiresIn(expiresIn);
  } catch (error) {
    debugLog("Invalid polling parameters", { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid parameters",
    };
  }

  const timeoutMs = expiresIn * 1000;
  const startTime = Date.now();
  let currentInterval = intervalSeconds * 1000;
  let pollAttempts = 0;

  debugLog("Starting token polling", { timeoutMs, interval: currentInterval });

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

        // Validate token response
        try {
          validateToken(data.access_token);
          validateToken(data.refresh_token);
          validateExpiresIn(data.expires_in);
        } catch (validationError) {
          debugLog("Invalid token response", {
            error: String(validationError),
          });
          return {
            success: false,
            error: "Received invalid token from server",
          };
        }

        debugLog("Token received successfully", { pollAttempts });
        return {
          success: true,
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
        };
      }

      // Handle error responses
      const errorData = await response.json().catch(() => ({}));
      const oauthError = validateOAuthError(errorData);

      if (oauthError.error === "authorization_pending") {
        debugLog("Authorization pending, retrying...");
        continue;
      }

      if (oauthError.error === "slow_down") {
        currentInterval += 5000;
        debugLog("Server requested slow down", {
          newInterval: currentInterval,
        });
        continue;
      }

      if (oauthError.error === "expired_token") {
        debugLog("Device code expired");
        return {
          success: false,
          error: "Device code expired. Please try again.",
        };
      }

      if (oauthError.error === "access_denied") {
        debugLog("User denied authorization");
        return {
          success: false,
          error: "Authorization was denied",
        };
      }

      debugLog(`Token polling failed: ${oauthError.error}`, {
        description: oauthError.error_description,
      });
      return {
        success: false,
        error: oauthError.error_description || oauthError.error,
      };
    } catch (error) {
      debugLog("Network error during polling", { error: String(error) });
      
      // Continue polling on network errors
      if (Date.now() - startTime < timeoutMs) {
        continue;
      }
      
      return {
        success: false,
        error: "Network error occurred during authentication",
      };
    }
  }

  debugLog("Polling timeout exceeded", { attempts: pollAttempts });
  return { success: false, error: "Polling timeout - device code expired" };
}

/**
 * Refresh an expired access token using a refresh token
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}> {
  try {
    validateToken(refreshToken);
  } catch (error) {
    return {
      success: false,
      error: "Invalid refresh token",
    };
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

    const data = (await response.json()) as TokenResponse;

    // Validate new tokens
    validateToken(data.access_token);
    validateToken(data.refresh_token);
    validateExpiresIn(data.expires_in);

    debugLog("Token refresh successful");
    return {
      success: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  } catch (error) {
    debugLog("Token refresh failed", { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Token refresh failed",
    };
  }
}
