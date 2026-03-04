/**
 * Custom error types for Qwen OAuth Plugin
 */

export class QwenAuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
    public userMessage?: string,
  ) {
    super(message);
    this.name = "QwenAuthError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NetworkError extends QwenAuthError {
  constructor(message: string, userMessage?: string) {
    super(
      message,
      "NETWORK_ERROR",
      true,
      userMessage || "Network request failed. Please check your connection.",
    );
    this.name = "NetworkError";
  }
}

export class TokenExpiredError extends QwenAuthError {
  constructor(message: string = "Token has expired") {
    super(
      message,
      "TOKEN_EXPIRED",
      true,
      "Your authentication token has expired. Please re-authenticate.",
    );
    this.name = "TokenExpiredError";
  }
}

export class RateLimitError extends QwenAuthError {
  constructor(message: string, waitTimeMs?: number) {
    const userMsg = waitTimeMs
      ? `Rate limit exceeded. Please wait ${Math.ceil(waitTimeMs / 1000)} seconds.`
      : "Rate limit exceeded. Please try again later.";
    super(message, "RATE_LIMIT_EXCEEDED", true, userMsg);
    this.name = "RateLimitError";
  }
}

export class AuthorizationError extends QwenAuthError {
  constructor(message: string) {
    super(
      message,
      "AUTHORIZATION_ERROR",
      false,
      "Authorization failed. Please check your credentials.",
    );
    this.name = "AuthorizationError";
  }
}

export class ValidationError extends QwenAuthError {
  constructor(message: string, field?: string) {
    super(
      message,
      "VALIDATION_ERROR",
      false,
      field ? `Invalid ${field}: ${message}` : message,
    );
    this.name = "ValidationError";
  }
}

export class DeviceFlowError extends QwenAuthError {
  constructor(message: string, public errorType?: string) {
    super(message, "DEVICE_FLOW_ERROR", true, message);
    this.name = "DeviceFlowError";
  }
}

export class QwenTokenRefreshError extends QwenAuthError {
  constructor(message: string) {
    super(
      message,
      "TOKEN_REFRESH_ERROR",
      false,
      "Failed to refresh access token. Please re-authenticate.",
    );
    this.name = "QwenTokenRefreshError";
  }
}

/**
 * Type guard to check if error is recoverable
 */
export function isRecoverableError(error: unknown): boolean {
  if (error instanceof QwenAuthError) {
    return error.recoverable;
  }
  return false;
}

/**
 * Get user-friendly error message
 */
export function getUserMessage(error: unknown): string {
  if (error instanceof QwenAuthError && error.userMessage) {
    return error.userMessage;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "An unexpected error occurred";
}
