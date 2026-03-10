/**
 * Token management service
 * Handles token refresh, validation, and caching
 */

import { Mutex } from "../utils/mutex.js";
import { refreshAccessToken as oauthRefreshToken } from "../strategies/oauth.strategy.js";
import { credentialRepository } from "../repositories/credential.repository.js";
import { OAuthAuthDetails, TokenResponse, StoredCredentials } from "../types.js";
import { debugLog, infoLog, warnLog } from "../utils/logger.js";

const TOKEN_CACHE_DURATION = 5 * 60 * 1000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

export class TokenService {
  private cachedToken: string | null = null;
  private cachedTokenExpiry = 0;
  private lastRefreshTime = 0;
  private cachedAuth: OAuthAuthDetails | null = null;
  private mutex = new Mutex();

  setCachedAuth(auth: OAuthAuthDetails): void {
    this.cachedAuth = auth;
  }

  getCachedAuth(): OAuthAuthDetails | null {
    return this.cachedAuth;
  }

  async refreshIfNeeded(): Promise<OAuthAuthDetails> {
    const now = Date.now();

    if (this.cachedToken && now < this.cachedTokenExpiry && now - this.lastRefreshTime < TOKEN_CACHE_DURATION) {
      if (this.cachedAuth) {
        return this.cachedAuth;
      }
    }

    if (!this.cachedAuth) {
      throw new Error("No authentication available");
    }

    const expiresAt = this.cachedAuth.expires || 0;
    const timeUntilExpiry = expiresAt - now;
    const hasValidExpiry = expiresAt > now;
    const shouldRefresh =
      !this.cachedAuth.access ||
      !hasValidExpiry ||
      timeUntilExpiry < REFRESH_BEFORE_EXPIRY_MS;

    debugLog("Token refresh check", {
      hasAccess: !!this.cachedAuth.access,
      expiresAt: expiresAt > 0 ? new Date(expiresAt).toISOString() : "not set",
      timeUntilExpiry: timeUntilExpiry > 0 ? Math.round(timeUntilExpiry / 1000) + "s" : "EXPIRED",
      shouldRefresh,
    });

    if (!shouldRefresh && this.cachedToken) {
      debugLog("Token still valid, no refresh needed");
      return this.cachedAuth;
    }

    infoLog("Token refresh needed", {
      reason: !this.cachedAuth.access ? "no access token" : !hasValidExpiry ? "token expired" : "token expires soon",
    });

    return this.mutex.runExclusive(async () => {
      const currentAuth = this.cachedAuth;
      if (!currentAuth || !currentAuth.refresh) {
        throw new Error("No refresh token available");
      }

      const result = await oauthRefreshToken(currentAuth.refresh);

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

        this.cachedAuth = newAuth;
        this.cachedToken = newAuth.access;
        this.cachedTokenExpiry = newExpires;
        this.lastRefreshTime = Date.now();

        this.saveCredentials(newAuth);

        return newAuth;
      }

      warnLog("Token refresh failed", { error: result.error });
      throw new Error(result.error || "Token refresh failed");
    });
  }

  private saveCredentials(auth: OAuthAuthDetails): void {
    credentialRepository.save({
      accessToken: auth.access,
      refreshToken: auth.refresh,
      expiryDate: auth.expires || Date.now() + 3600 * 1000,
      tokenType: "Bearer",
    });
  }

  loadFromFile(): OAuthAuthDetails | null {
    const stored = credentialRepository.load();
    if (!stored) return null;

    return {
      type: "oauth",
      access: stored.accessToken,
      refresh: stored.refreshToken,
      expires: stored.expiryDate,
    };
  }

  reset(): void {
    this.cachedToken = null;
    this.cachedTokenExpiry = 0;
    this.lastRefreshTime = 0;
    this.cachedAuth = null;
  }
}

export const tokenService = new TokenService();
