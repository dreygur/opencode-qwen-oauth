/**
 * Configuration system for Qwen OAuth Plugin
 */

export interface QwenConfig {
  /** Request timeout in milliseconds */
  timeout: number;
  /** Maximum number of retries for failed requests */
  maxRetries: number;
  /** Time before token expiry to trigger refresh (milliseconds) */
  refreshThreshold: number;
  /** Logging level */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Base delay for exponential backoff (milliseconds) */
  baseRetryDelay: number;
  /** Maximum delay for exponential backoff (milliseconds) */
  maxRetryDelay: number;
}

export const defaultConfig: QwenConfig = {
  timeout: 30000, // 30 seconds
  maxRetries: 3,
  refreshThreshold: 300000, // 5 minutes
  logLevel: process.env.QWEN_OAUTH_DEBUG === "true" ? "debug" : "info",
  baseRetryDelay: 1000, // 1 second
  maxRetryDelay: 30000, // 30 seconds
};

/**
 * Get configuration with environment variable overrides
 */
export function getConfig(): QwenConfig {
  return {
    timeout: parseInt(process.env.QWEN_OAUTH_TIMEOUT || String(defaultConfig.timeout)),
    maxRetries: parseInt(process.env.QWEN_OAUTH_MAX_RETRIES || String(defaultConfig.maxRetries)),
    refreshThreshold: parseInt(process.env.QWEN_OAUTH_REFRESH_THRESHOLD || String(defaultConfig.refreshThreshold)),
    logLevel: (process.env.QWEN_OAUTH_LOG_LEVEL as any) || defaultConfig.logLevel,
    baseRetryDelay: defaultConfig.baseRetryDelay,
    maxRetryDelay: defaultConfig.maxRetryDelay,
  };
}
