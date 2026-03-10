/**
 * Retry middleware with exponential backoff
 */

import { debugLog, warnLog } from "../utils/logger.js";

export interface RetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  timeout?: number;
}

const DEFAULT_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  timeout: 30000,
};

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  config: RetryConfig = {},
): Promise<Response> {
  const { maxRetries, baseDelay, maxDelay, timeout } = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After") || "60";
        const waitTimeMs = parseInt(retryAfter, 10) * 1000;
        warnLog("Rate limited (429), waiting and retrying", { retryAfter, waitTimeMs });
        await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      debugLog(`Request failed (attempt ${attempt + 1}/${maxRetries + 1})`, { error: lastError.message });

      if (attempt < maxRetries) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Request failed after all retries");
}
