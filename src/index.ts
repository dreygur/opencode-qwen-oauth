/**
 * Qwen OAuth Plugin for OpenCode
 * Provides OAuth device flow authentication for Qwen.ai
 * With proactive token refresh via custom fetch loader
 *
 * @packageDocumentation
 */

const PLUGIN_VERSION = "2.3.1";
const QWEN_CODE_VERSION = "0.10.3";
const TOKEN_CACHE_DURATION = 5 * 60 * 1000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

let cachedToken: string | null = null;
let cachedTokenExpiry = 0;
let lastRefreshTime = 0;

type RequestInfoType = Request | URL | string;

import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import { QWEN_API_BASE_URL } from "./constants.js";
import { openBrowser } from "./browser.js";
import { authorizeDevice, pollForToken, refreshAccessToken } from "./oauth.js";
import { Mutex } from "./mutex.js";
import { getConfig } from "./config.js";
import { requestQueue } from "./request-queue.js";
import { saveCredentials, loadCredentials } from "./credentials.js";

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

function resetTokenCache(): void {
  cachedToken = null;
  cachedTokenExpiry = 0;
  lastRefreshTime = 0;
}

type GetAuth = () => Promise<any>;

export const QwenOAuthPlugin: Plugin = async ({
  project,
  client,
  directory,
  worktree,
}: PluginInput) => {
  const log = async (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => {
    try {
      await client.app.log({
        body: {
          service: "qwen-oauth",
          level,
          message,
          extra: data,
        },
      });
    } catch {
      // Fallback to console if client.app.log fails
      console.log(`[${level}] ${message}`, data || "");
    }
  };

  const debugLog = (message: string, data?: Record<string, unknown>) => log("debug", message, data);
  const infoLog = (message: string, data?: Record<string, unknown>) => log("info", message, data);
  const warnLog = (message: string, data?: Record<string, unknown>) => log("warn", message, data);

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
        // First try to get auth from OpenCode runtime
        let auth = await getAuth();
        
        // If no valid runtime auth, try loading from file
        if (!auth || auth.type !== "oauth" || !auth.access || !auth.refresh) {
          console.log("[Qwen] No runtime auth, trying to load from file...");
          const fileCredentials = loadCredentials();
          if (fileCredentials && fileCredentials.accessToken && fileCredentials.refreshToken) {
            console.log("[Qwen] Loaded credentials from file", {
              hasAccess: !!fileCredentials.accessToken,
              hasRefresh: !!fileCredentials.refreshToken,
              expiryDate: fileCredentials.expiryDate,
            });
            // Use file credentials as fallback
            auth = {
              type: "oauth",
              access: fileCredentials.accessToken,
              refresh: fileCredentials.refreshToken,
              expires: fileCredentials.expiryDate,
            };
          }
        }
        
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
          const now = Date.now();
          
          if (cachedToken && now < cachedTokenExpiry && now - lastRefreshTime < TOKEN_CACHE_DURATION) {
            if (cachedAuth) {
              return cachedAuth;
            }
          }

          if (!cachedAuth) {
            throw new Error("No authentication available");
          }

          const expiresAt = cachedAuth.expires || 0;
          const timeUntilExpiry = expiresAt - now;
          
          const hasValidExpiry = expiresAt > now;
          const shouldRefresh = 
            !cachedAuth.access ||
            !hasValidExpiry ||
            timeUntilExpiry < REFRESH_BEFORE_EXPIRY_MS;

          debugLog("Token refresh check", {
            hasAccess: !!cachedAuth.access,
            expiresAt: expiresAt > 0 ? new Date(expiresAt).toISOString() : "not set",
            timeUntilExpiry: timeUntilExpiry > 0 ? Math.round(timeUntilExpiry / 1000) + "s" : "EXPIRED",
            hasValidExpiry,
            refreshThreshold: REFRESH_BEFORE_EXPIRY_MS,
            shouldRefresh,
            cachedToken: !!cachedToken,
            cacheValid: !!(cachedToken && now < cachedTokenExpiry),
          });

          if (!shouldRefresh && cachedToken) {
            debugLog("Token is still valid (cached), no refresh needed");
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

              cachedToken = newAuth.access;
              cachedTokenExpiry = newExpires;
              lastRefreshTime = Date.now();

              // Save refreshed credentials to file
              saveCredentials({
                accessToken: newAuth.access,
                refreshToken: newAuth.refresh,
                expiryDate: newExpires,
                tokenType: "Bearer",
              });

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
            
            const userAgent = `QwenCode/${QWEN_CODE_VERSION} (${process.platform}; ${process.arch})`;
            
            return requestQueue.enqueue(async () => {
              for (let attempt = 0; attempt <= 2; attempt++) {
                let url: string;
                if (typeof input === "string") {
                  url = input;
                } else if (input instanceof URL) {
                  url = input.toString();
                } else {
                  url = (input as Request).url;
                }

                const headers = new Headers(init?.headers);
                
                const tokenToUse = auth.apiKey || auth.access;
                
                if (tokenToUse) {
                  headers.set("Authorization", `Bearer ${tokenToUse}`);
                  headers.set("User-Agent", userAgent);
                  headers.set("X-DashScope-CacheControl", "enable");
                  headers.set("X-DashScope-UserAgent", userAgent);
                  headers.set("X-DashScope-AuthType", "qwen-oauth");
                  
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

                debugLog("API response received", {
                  url,
                  status: response.status,
                  statusText: response.statusText,
                  attempt,
                });

                if (response.status === 429) {
                  const retryAfter = response.headers.get("Retry-After") || "60";
                  const waitTimeMs = Number.parseInt(retryAfter, 10) * 1000;
                  warnLog("Rate limited (429), waiting and retrying", {
                    retryAfter,
                    waitTimeMs,
                    url,
                  });
                  await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                  continue;
                }

                if (response.status === 401 || response.status === 403) {
                  const errorBody = await response.clone().json().catch(() => ({})) as Record<string, unknown>;
                  warnLog("Received 401/403 Unauthorized from Qwen API", { 
                    attempt,
                    url,
                    error: errorBody.error || errorBody.message,
                  });

                  const refreshedAuth = await tokenRefreshMutex.runExclusive(async () => {
                    const currentAuth = cachedAuth;
                    if (!currentAuth || !currentAuth.refresh) {
                      throw new Error("No refresh token available");
                    }

                    const result = await refreshAccessToken(currentAuth.refresh);

                    if (result.success && result.access_token) {
                      const expiresIn = result.expires_in || 0;
                      const newExpires = expiresIn > 0 
                        ? Date.now() + expiresIn * 1000 
                        : Date.now() + 3600 * 1000;
                      
                      const newAuth: OAuthAuthDetails = {
                        type: "oauth",
                        refresh: result.refresh_token || currentAuth.refresh,
                        access: result.access_token,
                        expires: newExpires,
                        apiKey: result.api_key || currentAuth.apiKey,
                      };

                      cachedAuth = newAuth;

                      // Save refreshed credentials to file
                      saveCredentials({
                        accessToken: newAuth.access,
                        refreshToken: newAuth.refresh,
                        expiryDate: newExpires,
                        tokenType: "Bearer",
                      });

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
                    warnLog("Authentication failed - please re-authenticate", {
                      url,
                      suggestion: "Run '/connect' in OpenCode to re-authenticate with Qwen"
                    });
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

              return new Response(JSON.stringify({
                error: {
                  code: "max_retries_exceeded",
                  message: "Maximum retry attempts exceeded",
                  type: "server_error"
                }
              }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
              });
            });
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

                    // Save credentials to file for persistence across sessions
                    console.log("[Qwen] Saving credentials after OAuth...");
                    saveCredentials({
                      accessToken: result.access_token || "",
                      refreshToken: result.refresh_token,
                      expiryDate: expires,
                      tokenType: "Bearer",
                    });
                    console.log("[Qwen] Credentials saved to ~/.qwen/oauth_creds.json");

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
          "coder-model": {
            id: "coder-model",
            name: "Qwen Coder",
            limit: { context: 1048576, output: 65536 },
            modalities: { input: ["text"], output: ["text"] },
          },
          "vision-model": {
            id: "vision-model",
            name: "Qwen Vision",
            limit: { context: 131072, output: 32768 },
            modalities: { input: ["text", "image"], output: ["text"] },
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
      const providerId = (input.provider as any)?.info?.id || (input.provider as any)?.id;
      if (providerId === "qwen" || providerId === "qwen-code") {
        debugLog("Adding custom headers for Qwen request", {
          model: input.model.id,
          session: input.sessionID,
          providerId,
        });

        const userAgent = `QwenCode/${QWEN_CODE_VERSION} (${process.platform}; ${process.arch})`;
        output.headers["User-Agent"] = userAgent;
        output.headers["X-DashScope-CacheControl"] = "enable";
        output.headers["X-DashScope-UserAgent"] = userAgent;
        output.headers["X-DashScope-AuthType"] = "qwen-oauth";
      }
    },

    "chat.params": async (input, output) => {
      const providerId = (input.provider as any)?.info?.id || (input.provider as any)?.id;
      if (providerId === "qwen" || providerId === "qwen-code") {
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
