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
  // Reduced minimum length from 20 to 10 to support various token formats
  if (token.length < 10) {
    throw new ValidationError("Token is too short", "token");
  }
  // Additional security check: ensure token contains only valid characters
  if (!/^[\w\-\.~+/]+=*$/.test(token)) {
    throw new ValidationError("Token contains invalid characters", "token");
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
 * Validate expires_in value (optional field)
 * Returns a default value if invalid or missing
 */
export function validateExpiresIn(expiresIn: number | undefined, defaultValue: number = 3600): number {
  // If missing or invalid, return default
  if (expiresIn === undefined || expiresIn === null || !Number.isInteger(expiresIn) || expiresIn <= 0) {
    return defaultValue;
  }
  
  // Sanity check: shouldn't be more than 1 year
  if (expiresIn > 365 * 24 * 60 * 60) {
    return defaultValue;
  }
  
  return expiresIn;
}

/**
 * Validate interval for polling (optional field)
 * Returns a default value if invalid or missing
 */
export function validateInterval(interval: number | undefined, defaultValue: number = 5): number {
  // If missing or invalid, return default
  if (interval === undefined || interval === null || !Number.isInteger(interval) || interval <= 0) {
    return defaultValue;
  }
  
  // Clamp to valid range: 1-60 seconds
  if (interval < 1) return 1;
  if (interval > 60) return 60;
  
  return interval;
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
