/**
 * Retry logic with exponential backoff for network requests
 */

import { NetworkError, isRecoverableError } from "./errors.js";
import { debugLog } from "./logger.js";

export interface RetryOptions {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  timeout?: number;
}

const defaultOptions: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  timeout: 30000,
};

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const opts = { ...defaultOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < opts.maxRetries; attempt++) {
    try {
      debugLog(`Attempt ${attempt + 1}/${opts.maxRetries}`);

      // Add timeout wrapper
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Request timeout")),
            opts.timeout,
          ),
        ),
      ]);

      debugLog(`Attempt ${attempt + 1} succeeded`);
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if error is not recoverable
      if (!isRecoverableError(error)) {
        debugLog(`Non-recoverable error, not retrying: ${lastError.message}`);
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxRetries - 1) {
        debugLog(`Max retries (${opts.maxRetries}) reached`);
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = opts.baseDelay * Math.pow(2, attempt);
      const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
      const delay = Math.min(exponentialDelay + jitter, opts.maxDelay);

      debugLog(`Retrying in ${Math.round(delay)}ms...`, {
        attempt: attempt + 1,
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new NetworkError(
    `Failed after ${opts.maxRetries} retries: ${lastError?.message}`,
  );
}

/**
 * Retry fetch with exponential backoff
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  return retryWithBackoff(async () => {
    const response = await fetch(url, init);

    // Throw on HTTP errors for retry logic
    if (!response.ok) {
      // Check for rate limiting
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
        throw new NetworkError(
          `Rate limited (429)`,
          `Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds.`,
        );
      }

      // Don't retry on 401/403 - these are auth errors that need special handling
      // Throwing them as NetworkError would block OAuth error handling in caller
      if (response.status === 401 || response.status === 403) {
        return response;
      }

      // Other HTTP errors
      throw new NetworkError(
        `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return response;
  }, options);
}
