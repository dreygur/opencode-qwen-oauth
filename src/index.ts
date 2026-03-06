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
import { debugLog, infoLog, warnLog } from "./logger.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken, refreshAccessToken } from "./oauth.js";
import { Mutex } from "./mutex.js";
import { getConfig } from "./config.js";

interface OAuthAuthDetails {
  type: "oauth";
  refresh: string;
  access: string;
  expires?: number;
  apiKey?: string; // Qwen-specific: API key for portal.qwen.ai (if different from access token)
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
        
        debugLog("Auth loader called", {
          hasAuth: !!auth,
          authType: auth?.type,
          hasAccess: !!auth?.access,
          hasAccessToken: !!auth?.access_token,
          hasAccessTokenCamel: !!auth?.accessToken,
          hasRefresh: !!auth?.refresh,
          hasRefreshToken: !!auth?.refresh_token,
          hasRefreshTokenCamel: !!auth?.refreshToken,
          expires: auth?.expires,
          expiresAt: auth?.expires_at,
        });
        
        if (!auth || auth.type !== "oauth") {
          return {};
        }

        // Handle multiple field name formats:
        // - OpenCode uses camelCase: accessToken, refreshToken
        // - OAuth spec uses snake_case: access_token, refresh_token
        // - Plugin internal uses short names: access, refresh
        // - Qwen-specific: apiKey or api_key for API endpoint access
        const normalizedAuth: OAuthAuthDetails = {
          type: "oauth",
          access: auth.access || auth.access_token || auth.accessToken || "",
          refresh: auth.refresh || auth.refresh_token || auth.refreshToken || "",
          expires: auth.expires || auth.expires_at || 0,
          apiKey: auth.apiKey || auth.api_key || undefined,
        };
        
        // Defensive check: ensure we actually have tokens
        if (!normalizedAuth.access || !normalizedAuth.refresh) {
          warnLog("Empty tokens after normalization - authentication may have failed", {
            hasAccess: !!normalizedAuth.access,
            hasRefresh: !!normalizedAuth.refresh,
            authKeys: Object.keys(auth),
            authValue: JSON.stringify(auth).substring(0, 200), // First 200 chars for debugging
          });
          return {};
        }
        
        // Check if token is already expired
        const now = Date.now();
        const isExpired = normalizedAuth.expires && normalizedAuth.expires <= now;
        const timeUntilExpiry = normalizedAuth.expires ? normalizedAuth.expires - now : 0;
        
        debugLog("Auth successfully normalized", {
          hasAccess: !!normalizedAuth.access,
          hasRefresh: !!normalizedAuth.refresh,
          hasApiKey: !!normalizedAuth.apiKey,
          expiresAt: normalizedAuth.expires ? new Date(normalizedAuth.expires).toISOString() : "never",
          expiresIn: timeUntilExpiry > 0 ? Math.round(timeUntilExpiry / 1000) + "s" : "EXPIRED",
          isExpired,
        });
        
        // Log which token will be used for API calls
        if (normalizedAuth.apiKey) {
          infoLog("Using separate API key for Qwen API calls (different from OAuth access token)");
        }
        
        if (isExpired) {
          warnLog("Token is already expired, will refresh on first request", {
            expiredAt: normalizedAuth.expires ? new Date(normalizedAuth.expires).toISOString() : "unknown",
            expiredAgo: Math.round((now - (normalizedAuth.expires || now)) / 1000) + " seconds ago",
          });
        } else {
          infoLog("Auth loader: Tokens loaded successfully", {
            expiresIn: normalizedAuth.expires ? Math.round((normalizedAuth.expires - Date.now()) / 1000 / 60) + " minutes" : "unknown",
            hasApiKey: !!normalizedAuth.apiKey,
          });
        }
        
        cachedAuth = normalizedAuth;

        const refreshTokenIfNeeded = async (): Promise<OAuthAuthDetails> => {
          if (!cachedAuth) {
            throw new Error("No authentication available");
          }

          const now = Date.now();
          const expiresAt = cachedAuth.expires || 0;
          const timeUntilExpiry = expiresAt - now;
          
          // Only refresh if expiresAt is valid (in the future)
          const hasValidExpiry = expiresAt > now;
          const shouldRefresh = 
            !cachedAuth.access ||
            !hasValidExpiry ||
            timeUntilExpiry < config.refreshThreshold;

          debugLog("Token refresh check", {
            hasAccess: !!cachedAuth.access,
            expiresAt: expiresAt > 0 ? new Date(expiresAt).toISOString() : "not set",
            timeUntilExpiry: timeUntilExpiry > 0 ? Math.round(timeUntilExpiry / 1000) + "s" : "EXPIRED",
            hasValidExpiry,
            refreshThreshold: config.refreshThreshold,
            shouldRefresh,
          });

          if (!shouldRefresh) {
            debugLog("Token is still valid, no refresh needed");
            return cachedAuth;
          }

          infoLog("Token refresh needed - attempting refresh", {
            reason: !cachedAuth.access ? "no access token" : 
                    !hasValidExpiry ? "token expired" :
                    "token expires soon",
            timeUntilExpiry: timeUntilExpiry > 0 ? Math.round(timeUntilExpiry / 1000) + "s" : "EXPIRED",
          });

          return tokenRefreshMutex.runExclusive(async () => {
            const currentAuth = cachedAuth;
            if (!currentAuth || !currentAuth.refresh) {
              throw new Error("No refresh token available");
            }

            const result = await refreshAccessToken(currentAuth.refresh);

                  if (result.success && result.access_token) {
                    const expiresIn = result.expires_in || 0;
                    // Only update expiry if valid (> 0), otherwise use 1 hour default
                    const newExpires = expiresIn > 0 
                      ? Date.now() + expiresIn * 1000 
                      : Date.now() + 3600 * 1000; // Default: 1 hour from now

                    const newAuth: OAuthAuthDetails = {
                      type: "oauth",
                      refresh: result.refresh_token || currentAuth.refresh,
                      access: result.access_token,
                      expires: newExpires,
                      apiKey: result.api_key || currentAuth.apiKey, // Preserve or update API key
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
            let auth: OAuthAuthDetails;
            
            try {
              auth = await refreshTokenIfNeeded();
            } catch (refreshError) {
              warnLog("Failed to refresh token before API call", {
                error: String(refreshError),
              });
              
              // Return a clear error response
              return new Response(JSON.stringify({
                error: {
                  code: "token_refresh_failed",
                  message: "Failed to refresh your Qwen authentication token. Please run '/connect' in OpenCode to re-authenticate.",
                  type: "auth_error",
                  details: refreshError instanceof Error ? refreshError.message : String(refreshError)
                }
              }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
              });
            }
            
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
              
              // Use apiKey if available (Qwen-specific), otherwise use access token
              const tokenToUse = auth.apiKey || auth.access;
              
              if (tokenToUse) {
                headers.set("Authorization", `Bearer ${tokenToUse}`);
                debugLog("Making API request with token", {
                  url,
                  attempt,
                  tokenType: auth.apiKey ? "API Key" : "OAuth Access Token",
                  tokenLength: tokenToUse.length,
                  tokenPrefix: tokenToUse.substring(0, 20) + "...",
                  hasExpiry: !!auth.expires,
                  expiresAt: auth.expires ? new Date(auth.expires).toISOString() : "not set",
                  isExpired: auth.expires ? auth.expires <= Date.now() : "unknown",
                });
              } else {
                warnLog("No access token or API key available for API request", { url });
              }

              const response = await fetch(url, {
                ...init,
                headers,
              });

              lastResponse = response;
              
              debugLog("API response received", {
                url,
                status: response.status,
                statusText: response.statusText,
                attempt,
              });

              // Handle quota/rate limit errors (429)
              if (response.status === 429) {
                const errorBody = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
                warnLog("Quota/Rate limit exceeded (HTTP 429)", {
                  error: errorBody.error,
                  message: errorBody.message,
                  code: (errorBody as any).error?.code,
                  url,
                });
                
                // Return a clear error message to the user
                return new Response(JSON.stringify({
                  error: {
                    code: "quota_exceeded",
                    message: "Qwen API quota exceeded. Your free tier limit has been reached. Please wait for quota reset or upgrade your account at https://chat.qwen.ai",
                    type: "quota_error"
                  }
                }), {
                  status: 429,
                  headers: { "Content-Type": "application/json" },
                });
              }

              if (response.status === 401 && attempt < maxRetries) {
                const errorBody = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
                warnLog("Received 401 Unauthorized from Qwen API", { 
                  attempt,
                  url,
                  error: errorBody.error || errorBody.message,
                  errorDescription: errorBody.error_description || errorBody.message,
                  fullErrorBody: JSON.stringify(errorBody).substring(0, 500),
                  tokenExpiresAt: auth.expires ? new Date(auth.expires).toISOString() : "not set",
                  tokenIsExpired: auth.expires ? auth.expires <= Date.now() : "unknown",
                });

                const refreshedAuth = await tokenRefreshMutex.runExclusive(async () => {
                  const currentAuth = cachedAuth;
                  if (!currentAuth || !currentAuth.refresh) {
                    throw new Error("No refresh token available");
                  }

                  const result = await refreshAccessToken(currentAuth.refresh);

                  if (result.success && result.access_token) {
                    const expiresIn = result.expires_in || 0;
                    // Only update expiry if valid (> 0), otherwise use 1 hour default
                    const newExpires = expiresIn > 0 
                      ? Date.now() + expiresIn * 1000 
                      : Date.now() + 3600 * 1000; // Default: 1 hour from now
                    
                    const newAuth: OAuthAuthDetails = {
                      type: "oauth",
                      refresh: result.refresh_token || currentAuth.refresh,
                      access: result.access_token,
                      expires: newExpires,
                      apiKey: result.api_key || currentAuth.apiKey, // Preserve or update API key
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
                  warnLog("Authentication failed - please re-authenticate", {
                    url,
                    suggestion: "Run '/connect' in OpenCode to re-authenticate with Qwen"
                  });
                  // Return a clear 401 response with error message
                  return new Response(JSON.stringify({
                    error: {
                      code: "authentication_required",
                      message: "Your Qwen authentication has expired. Please run '/connect' in OpenCode and re-authenticate.",
                      type: "auth_error"
                    }
                  }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" },
                  });
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
                    const expiresIn = result.expires_in || 0;
                    // Default to 6 hours (21600s) if not provided, matching Qwen's typical expiry
                    const expires = expiresIn > 0 
                      ? Date.now() + expiresIn * 1000 
                      : Date.now() + 21600 * 1000;

                    const authResult: OAuthAuthDetails = {
                      type: "oauth",
                      refresh: result.refresh_token || "",
                      access: result.access_token || "",
                      expires,
                      apiKey: result.api_key,
                    };

                    cachedAuth = authResult;

                    debugLog("Qwen authentication successful!", {
                      expires_in: result.expires_in,
                      has_refresh: !!result.refresh_token,
                      has_api_key: !!result.api_key,
                    });
                    
                    if (result.api_key) {
                      infoLog("Received separate API key for Qwen API - will use for API calls");
                    }

                    return {
                      type: "success",
                      refresh: result.refresh_token || "",
                      access: result.access_token || "",
                      expires: expires || 0,
                      apiKey: result.api_key, // Qwen-specific API key
                      api_key: result.api_key, // Also include snake_case version for compatibility
                    } as any;
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
