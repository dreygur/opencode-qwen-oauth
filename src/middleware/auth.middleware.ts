/**
 * Authentication middleware for fetch requests
 * Handles token injection, retry logic, and error recovery
 */

import { tokenService } from "../services/token.service.js";
import { requestQueue } from "./rate-limit.middleware.js";
import { credentialRepository } from "../repositories/credential.repository.js";
import { OAuthAuthDetails } from "../types.js";
import { debugLog, warnLog, infoLog } from "../utils/logger.js";
import { refreshAccessToken } from "../strategies/oauth.strategy.js";
import { Mutex } from "../utils/mutex.js";

const QWEN_CODE_VERSION = "0.10.3";
const tokenRefreshMutex = new Mutex();

export interface AuthMiddlewareConfig {
  platform: string;
  arch: string;
}

export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const userAgent = `QwenCode/${QWEN_CODE_VERSION} (${config.platform}; ${config.arch})`;

  return async function authFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const auth = await getAuthWithRefresh();

    if (!auth) {
      return createErrorResponse(401, "No authentication available");
    }

    return requestQueue.enqueue(async () => {
      let currentAuth: OAuthAuthDetails = auth;

      for (let attempt = 0; attempt <= 2; attempt++) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : (input as Request).url;
        const headers = new Headers(init?.headers);
        const tokenToUse = currentAuth.apiKey || currentAuth.access;

        if (tokenToUse) {
          headers.set("Authorization", `Bearer ${tokenToUse}`);
          headers.set("User-Agent", userAgent);
          headers.set("X-DashScope-CacheControl", "enable");
          headers.set("X-DashScope-UserAgent", userAgent);
          headers.set("X-DashScope-AuthType", "qwen-oauth");
        }

        const response = await fetch(url, { ...init, headers });

        if (response.status === 429) {
          const retryAfter = response.headers.get("Retry-After") || "60";
          await new Promise((resolve) => setTimeout(resolve, parseInt(retryAfter, 10) * 1000));
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          const refreshedAuth = await handleAuthFailure(currentAuth);
          if (refreshedAuth) {
            currentAuth = refreshedAuth;
            continue;
          }
          return createErrorResponse(401, "Authentication failed. Please re-authenticate.");
        }

        return response;
      }

      return createErrorResponse(500, "Maximum retry attempts exceeded");
    });
  };

  async function getAuthWithRefresh(): Promise<OAuthAuthDetails | null> {
    try {
      return await tokenService.refreshIfNeeded();
    } catch (error) {
      warnLog("Failed to refresh token", { error: String(error) });
      const fileAuth = tokenService.loadFromFile();
      if (fileAuth) {
        tokenService.setCachedAuth(fileAuth);
        return fileAuth;
      }
      return null;
    }
  }

  async function handleAuthFailure(currentAuth: OAuthAuthDetails): Promise<OAuthAuthDetails | null> {
    warnLog("Received 401/403, attempting token refresh");

    return tokenRefreshMutex.runExclusive(async () => {
      if (!currentAuth.refresh) {
        return null;
      }

      const result = await refreshAccessToken(currentAuth.refresh);

      if (result.success && result.access_token) {
        const expiresIn = result.expires_in || 0;
        const newExpires = expiresIn > 0 ? Date.now() + expiresIn * 1000 : Date.now() + 3600 * 1000;

        const newAuth: OAuthAuthDetails = {
          type: "oauth",
          refresh: result.refresh_token || currentAuth.refresh,
          access: result.access_token,
          expires: newExpires,
          apiKey: result.api_key || currentAuth.apiKey,
        };

        tokenService.setCachedAuth(newAuth);
        credentialRepository.save({
          accessToken: newAuth.access,
          refreshToken: newAuth.refresh,
          expiryDate: newExpires,
          tokenType: "Bearer",
        });

        infoLog("Token refreshed after 401/403");
        return newAuth;
      }

      return null;
    });
  }

  function createErrorResponse(status: number, message: string): Response {
    return new Response(
      JSON.stringify({
        error: { code: "auth_error", message, type: "auth_error" },
      }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }
}
