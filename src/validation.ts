/**
 * Input validation and security utilities
 */

import { ValidationError } from "./errors.js";

/**
 * Validate URL is HTTPS and from qwen.ai domain
 */
export function validateQwenUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "chat.qwen.ai" ||
        parsed.hostname === "portal.qwen.ai" ||
        parsed.hostname.endsWith(".qwen.ai"))
    );
  } catch {
    return false;
  }
}

/**
 * Validate device code format
 */
export function validateDeviceCode(code: string): void {
  if (!code || typeof code !== "string") {
    throw new ValidationError("Device code must be a non-empty string", "device_code");
  }
  if (code.length < 10 || code.length > 100) {
    throw new ValidationError("Device code has invalid length", "device_code");
  }
}

/**
 * Validate user code format
 */
export function validateUserCode(code: string): void {
  if (!code || typeof code !== "string") {
    throw new ValidationError("User code must be a non-empty string", "user_code");
  }
  // User codes are typically short alphanumeric codes
  if (!/^[A-Z0-9-]{4,12}$/i.test(code)) {
    throw new ValidationError("User code has invalid format", "user_code");
  }
}

/**
 * Validate access token format
 */
export function validateToken(token: string): void {
  if (!token || typeof token !== "string") {
    throw new ValidationError("Token must be a non-empty string", "token");
  }
  if (token.length < 20) {
    throw new ValidationError("Token is too short", "token");
  }
}

/**
 * Validate token type (per RFC 6749)
 */
export function validateTokenType(tokenType: string): void {
  if (!tokenType || typeof tokenType !== "string") {
    throw new ValidationError("token_type must be a non-empty string", "token_type");
  }
  // Common token types: Bearer, MAC, etc.
  // Per RFC 6749, token_type is case-insensitive
  const normalizedType = tokenType.toLowerCase();
  if (normalizedType !== "bearer" && normalizedType !== "mac") {
    // Log warning but don't fail - allow other token types
    // as the spec allows for extensions
  }
}

/**
 * Validate expires_in value
 */
export function validateExpiresIn(expiresIn: number): void {
  if (!Number.isInteger(expiresIn) || expiresIn <= 0) {
    throw new ValidationError("expires_in must be a positive integer", "expires_in");
  }
  // Sanity check: shouldn't be more than 1 year
  if (expiresIn > 365 * 24 * 60 * 60) {
    throw new ValidationError("expires_in value is unreasonably large", "expires_in");
  }
}

/**
 * Validate interval for polling
 */
export function validateInterval(interval: number): void {
  if (!Number.isInteger(interval) || interval <= 0) {
    throw new ValidationError("Interval must be a positive integer", "interval");
  }
  // Minimum 1 second, maximum 60 seconds
  if (interval < 1 || interval > 60) {
    throw new ValidationError("Interval must be between 1 and 60 seconds", "interval");
  }
}

/**
 * Sanitize log data by removing sensitive fields
 */
export function sanitizeLogData(data: any): any {
  if (!data || typeof data !== "object") {
    return data;
  }

  const sensitiveFields = [
    "access_token",
    "refresh_token",
    "api_key",
    "apiKey",
    "secret",
    "password",
    "verifier",
    "device_code",
  ];

  const sanitized: any = Array.isArray(data) ? [] : {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveFields.some((field) => lowerKey.includes(field))) {
      sanitized[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      sanitized[key] = sanitizeLogData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validate OAuth error response
 * Returns a safe error object even if the response is malformed
 */
export function validateOAuthError(error: any): {
  error: string;
  error_description?: string;
} {
  if (!error || typeof error !== "object") {
    return {
      error: "unknown_error",
      error_description: "Server returned invalid error response",
    };
  }
  if (!error.error || typeof error.error !== "string") {
    return {
      error: "unknown_error",
      error_description: error.message || "Server returned malformed error response",
    };
  }
  return {
    error: error.error,
    error_description: error.error_description,
  };
}
