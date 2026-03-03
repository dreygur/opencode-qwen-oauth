import { test, expect, describe } from "bun:test";
import {
  validateQwenUrl,
  validateDeviceCode,
  validateUserCode,
  validateToken,
  validateExpiresIn,
  validateInterval,
  sanitizeLogData,
} from "../src/validation";
import { ValidationError } from "../src/errors";

describe("Validation", () => {
  describe("validateQwenUrl", () => {
    test("should accept valid Qwen URLs", () => {
      expect(validateQwenUrl("https://chat.qwen.ai/auth")).toBe(true);
      expect(validateQwenUrl("https://portal.qwen.ai/v1")).toBe(true);
      expect(validateQwenUrl("https://api.qwen.ai/test")).toBe(true);
    });

    test("should reject non-HTTPS URLs", () => {
      expect(validateQwenUrl("http://chat.qwen.ai")).toBe(false);
    });

    test("should reject non-Qwen domains", () => {
      expect(validateQwenUrl("https://example.com")).toBe(false);
      expect(validateQwenUrl("https://fake-qwen.ai.com")).toBe(false);
    });

    test("should reject invalid URLs", () => {
      expect(validateQwenUrl("not-a-url")).toBe(false);
    });
  });

  describe("validateDeviceCode", () => {
    test("should accept valid device codes", () => {
      expect(() => validateDeviceCode("valid_device_code_123")).not.toThrow();
    });

    test("should reject empty codes", () => {
      expect(() => validateDeviceCode("")).toThrow(ValidationError);
    });

    test("should reject too short codes", () => {
      expect(() => validateDeviceCode("short")).toThrow(ValidationError);
    });

    test("should reject too long codes", () => {
      const longCode = "a".repeat(101);
      expect(() => validateDeviceCode(longCode)).toThrow(ValidationError);
    });
  });

  describe("validateUserCode", () => {
    test("should accept valid user codes", () => {
      expect(() => validateUserCode("ABCD-1234")).not.toThrow();
      expect(() => validateUserCode("XYZW123")).not.toThrow();
    });

    test("should reject invalid formats", () => {
      expect(() => validateUserCode("abc")).toThrow(ValidationError);
      expect(() => validateUserCode("TOOLONG12345")).toThrow(ValidationError);
      expect(() => validateUserCode("invalid!")).toThrow(ValidationError);
    });
  });

  describe("validateToken", () => {
    test("should accept valid tokens", () => {
      const validToken = "a".repeat(50);
      expect(() => validateToken(validToken)).not.toThrow();
    });

    test("should reject short tokens", () => {
      expect(() => validateToken("short")).toThrow(ValidationError);
    });

    test("should reject empty tokens", () => {
      expect(() => validateToken("")).toThrow(ValidationError);
    });
  });

  describe("validateExpiresIn", () => {
    test("should accept valid expiration times", () => {
      expect(() => validateExpiresIn(3600)).not.toThrow();
      expect(() => validateExpiresIn(86400)).not.toThrow();
    });

    test("should reject negative values", () => {
      expect(() => validateExpiresIn(-1)).toThrow(ValidationError);
    });

    test("should reject zero", () => {
      expect(() => validateExpiresIn(0)).toThrow(ValidationError);
    });

    test("should reject unreasonably large values", () => {
      const tooLarge = 365 * 24 * 60 * 60 + 1;
      expect(() => validateExpiresIn(tooLarge)).toThrow(ValidationError);
    });
  });

  describe("validateInterval", () => {
    test("should accept valid intervals", () => {
      expect(() => validateInterval(5)).not.toThrow();
      expect(() => validateInterval(30)).not.toThrow();
    });

    test("should reject intervals outside range", () => {
      expect(() => validateInterval(0)).toThrow(ValidationError);
      expect(() => validateInterval(61)).toThrow(ValidationError);
    });
  });

  describe("sanitizeLogData", () => {
    test("should redact sensitive fields", () => {
      const data = {
        access_token: "secret123",
        refresh_token: "secret456",
        user_code: "ABC123",
      };

      const sanitized = sanitizeLogData(data);

      expect(sanitized.access_token).toBe("[REDACTED]");
      expect(sanitized.refresh_token).toBe("[REDACTED]");
      expect(sanitized.user_code).toBe("ABC123");
    });

    test("should handle nested objects", () => {
      const data = {
        auth: {
          api_key: "secret",
          username: "user",
        },
      };

      const sanitized = sanitizeLogData(data);

      expect(sanitized.auth.api_key).toBe("[REDACTED]");
      expect(sanitized.auth.username).toBe("user");
    });

    test("should handle non-objects", () => {
      expect(sanitizeLogData(null)).toBe(null);
      expect(sanitizeLogData("string")).toBe("string");
      expect(sanitizeLogData(123)).toBe(123);
    });
  });
});
