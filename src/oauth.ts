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
import { debugLog, warnLog, infoLog } from "./logger.js";
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
  validateTokenType,
  validateExpiresIn,
  validateInterval,
  validateQwenUrl,
  validateOAuthError,
} from "./validation.js";
import { getConfig } from "./config.js";
import { Mutex } from "./mutex.js";

// Global mutex for token refresh to prevent race conditions
const tokenRefreshMutex = new Mutex();

// Track active polling operations
const activePollingOperations = new Set<string>();

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
  token_type: string;
  expires_in: number;
  refresh_token?: string; // Optional per RFC 6749 - may not be returned on refresh
  scope?: string;
  api_key?: string; // Qwen-specific: API key for portal.qwen.ai
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
    
    // Validate and normalize expires_in (with default if missing)
    const expiresIn = validateExpiresIn(data.expires_in, 300); // Default 5 minutes for device code
    const interval = validateInterval(data.interval);

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
      expires_in: expiresIn,
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
  api_key?: string;
  error?: string;
}> {
  // Validate inputs
  try {
    validateDeviceCode(deviceCode);
    // Normalize interval and expiresIn with defaults if needed
    const normalizedInterval = validateInterval(intervalSeconds);
    const normalizedExpiresIn = validateExpiresIn(expiresIn);
    
    // Use normalized values
    intervalSeconds = normalizedInterval;
    expiresIn = normalizedExpiresIn;
  } catch (error) {
    debugLog("Invalid polling parameters", { error: String(error) });
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid parameters",
    };
  }

  // Prevent multiple concurrent polling for same device code
  if (activePollingOperations.has(deviceCode)) {
    warnLog("Polling already in progress for this device code", { deviceCode });
    return {
      success: false,
      error: "Authorization already in progress",
    };
  }

  // Register this polling operation
  activePollingOperations.add(deviceCode);

  const timeoutMs = expiresIn * 1000;
  const startTime = Date.now();
  let currentInterval = intervalSeconds * 1000;
  let pollAttempts = 0;

  debugLog("Starting token polling", { timeoutMs, interval: currentInterval });

  // Ensure cleanup on exit
  const cleanup = () => {
    activePollingOperations.delete(deviceCode);
  };

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
        const data = (await response.json()) as TokenResponse & Record<string, unknown>;

        // Log full response to help debug (sanitized)
        infoLog("🎯 Full OAuth token response received - PLEASE CHECK THIS", {
          hasAccessToken: !!data.access_token,
          hasRefreshToken: !!data.refresh_token,
          hasApiKey: !!data.api_key,
          tokenType: data.token_type,
          expiresIn: data.expires_in,
          scope: data.scope,
          allFields: Object.keys(data), // Show ALL fields in response
          additionalFields: Object.keys(data).filter(k => 
            !['access_token', 'refresh_token', 'token_type', 'expires_in', 'scope', 'api_key'].includes(k)
          ),
        });
        
        // Also log with console for visibility
        console.log("=".repeat(80));
        console.log("QWEN OAUTH RESPONSE - All fields:", Object.keys(data));
        console.log("Has api_key field?", !!data.api_key);
        console.log("=".repeat(80));

        // Validate token response
        try {
          validateToken(data.access_token);
          // refresh_token is optional per RFC 6749
          if (data.refresh_token) {
            validateToken(data.refresh_token);
          }
          
          // Validate api_key if present (Qwen-specific)
          if (data.api_key) {
            validateToken(data.api_key);
            infoLog("OAuth response includes api_key field - will use for API calls");
          }
          
          // Normalize expires_in with default if invalid
          const expiresIn = validateExpiresIn(data.expires_in, 3600); // Default to 1 hour
          
          // Validate token_type if provided (optional for compatibility)
          if (data.token_type) {
            validateTokenType(data.token_type);
          }
          
          debugLog("Token received successfully", { 
            pollAttempts,
            hasApiKey: !!data.api_key,
          });
          cleanup();
          return {
            success: true,
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            expires_in: expiresIn,
            api_key: data.api_key,
          };
        } catch (validationError) {
          debugLog("Invalid token response", {
            error: String(validationError),
          });
          cleanup();
          return {
            success: false,
            error: "Received invalid token from server",
          };
        }

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
        cleanup();
        return {
          success: false,
          error: "Device code expired. Please run '/connect' again and complete authentication within 15 minutes.",
        };
      }

      if (oauthError.error === "access_denied") {
        debugLog("User denied authorization");
        cleanup();
        return {
          success: false,
          error: "Authorization was denied",
        };
      }

      debugLog(`Token polling failed: ${oauthError.error}`, {
        description: oauthError.error_description,
      });
      cleanup();
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
      
      cleanup();
      return {
        success: false,
        error: "Network error occurred during authentication",
      };
    }
  }

  debugLog("Polling timeout exceeded", { attempts: pollAttempts });
  cleanup();
  return { success: false, error: "Polling timeout - device code expired" };
}

/**
 * Refresh an expired access token using a refresh token
 * Uses mutex to prevent race conditions when multiple requests
 * try to refresh the token simultaneously
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<{
  success: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  api_key?: string;
  error?: string;
}> {
  // Use mutex to ensure only one refresh happens at a time
  return tokenRefreshMutex.runExclusive(async () => {
    try {
      validateToken(refreshToken);
    } catch (error) {
      return {
        success: false,
        error: "Invalid refresh token",
      };
    }

    // Check if a refresh is already in progress
    if (tokenRefreshMutex.isLocked()) {
      debugLog("Token refresh already in progress, waiting...");
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

      // Check for OAuth error responses
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const oauthError = validateOAuthError(errorData);
        
        debugLog("OAuth error during token refresh", {
          status: response.status,
          statusText: response.statusText,
          error: oauthError.error,
          description: oauthError.error_description,
          fullResponse: errorData,
        });
        
        // Handle specific OAuth errors
        if (oauthError.error === "invalid_grant") {
          return {
            success: false,
            error: "Your refresh token has expired. Please run '/connect' in OpenCode to re-authenticate with Qwen.",
          };
        }
        
        if (oauthError.error === "invalid_client") {
          return {
            success: false,
            error: "OAuth client configuration error. Please update the plugin or contact support.",
          };
        }
        
        return {
          success: false,
          error: oauthError.error_description || oauthError.error || "Token refresh failed",
        };
      }

      const data = (await response.json()) as TokenResponse;

      // Validate new tokens
      validateToken(data.access_token);
      
      // Validate api_key if present (Qwen-specific)
      if (data.api_key) {
        validateToken(data.api_key);
        infoLog("Refresh response includes api_key field - will use for API calls");
      }
      
      // Normalize expires_in with default if invalid
      const expiresIn = validateExpiresIn(data.expires_in, 3600); // Default to 1 hour
      
      // Validate token_type if provided (optional for compatibility)
      if (data.token_type) {
        validateTokenType(data.token_type);
      }
      
      // Per RFC 6749: refresh_token is optional in refresh response
      // If not provided, continue using the old refresh token
      const newRefreshToken = data.refresh_token || refreshToken;
      if (!newRefreshToken) {
        debugLog("No refresh token available, using existing token");
      } else {
        validateToken(newRefreshToken);
      }

      debugLog("Token refresh successful", {
        new_refresh_token: !!data.refresh_token,
        has_api_key: !!data.api_key,
      });
      return {
        success: true,
        access_token: data.access_token,
        refresh_token: newRefreshToken,
        expires_in: expiresIn,
        api_key: data.api_key,
      };
    } catch (error) {
      debugLog("Token refresh failed", { error: String(error) });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  });
}
