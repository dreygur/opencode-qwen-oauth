import { test, describe } from "node:test";
import assert from "node:assert";
import {
  validateQwenUrl,
  validateDeviceCode,
  validateUserCode,
  validateToken,
  validateExpiresIn,
  validateInterval,
  sanitizeLogData,
} from "../src/validation.js";
import { ValidationError } from "../src/errors.js";

describe("Validation", () => {
  describe("validateQwenUrl", () => {
    test("should accept valid Qwen URLs", () => {
      assert.strictEqual(validateQwenUrl("https://chat.qwen.ai/auth"), true);
      assert.strictEqual(validateQwenUrl("https://portal.qwen.ai/v1"), true);
      assert.strictEqual(validateQwenUrl("https://api.qwen.ai/test"), true);
    });

    test("should reject non-HTTPS URLs", () => {
      assert.strictEqual(validateQwenUrl("http://chat.qwen.ai"), false);
    });

    test("should reject non-Qwen domains", () => {
      assert.strictEqual(validateQwenUrl("https://example.com"), false);
      assert.strictEqual(validateQwenUrl("https://fake-qwen.ai.com"), false);
    });

    test("should reject invalid URLs", () => {
      assert.strictEqual(validateQwenUrl("not-a-url"), false);
    });
  });

  describe("validateDeviceCode", () => {
    test("should accept valid device codes", () => {
      assert.doesNotThrow(() => validateDeviceCode("valid_device_code_123"));
    });

    test("should reject empty codes", () => {
      assert.throws(() => validateDeviceCode(""), ValidationError);
    });

    test("should reject too short codes", () => {
      assert.throws(() => validateDeviceCode("short"), ValidationError);
    });

    test("should reject too long codes", () => {
      const longCode = "a".repeat(101);
      assert.throws(() => validateDeviceCode(longCode), ValidationError);
    });
  });

  describe("validateUserCode", () => {
    test("should accept valid user codes", () => {
      assert.doesNotThrow(() => validateUserCode("ABCD-1234"));
      assert.doesNotThrow(() => validateUserCode("XYZW123"));
    });

    test("should reject invalid formats", () => {
      assert.throws(() => validateUserCode("abc"), ValidationError); // too short
      assert.throws(() => validateUserCode("TOOLONGCODE123"), ValidationError); // too long (>12)
      assert.throws(() => validateUserCode("invalid!"), ValidationError); // invalid chars
      assert.throws(() => validateUserCode("AB"), ValidationError); // too short
    });
  });

  describe("validateToken", () => {
    test("should accept valid tokens", () => {
      const validToken = "a".repeat(50);
      assert.doesNotThrow(() => validateToken(validToken));
    });

    test("should reject short tokens", () => {
      assert.throws(() => validateToken("short"), ValidationError);
    });

    test("should reject empty tokens", () => {
      assert.throws(() => validateToken(""), ValidationError);
    });
  });

  describe("validateExpiresIn", () => {
    test("should accept valid expiration times", () => {
      assert.strictEqual(validateExpiresIn(3600), 3600);
      assert.strictEqual(validateExpiresIn(86400), 86400);
    });

    test("should return default for negative values", () => {
      assert.strictEqual(validateExpiresIn(-1), 3600); // default
      assert.strictEqual(validateExpiresIn(-1, 7200), 7200); // custom default
    });

    test("should return default for zero", () => {
      assert.strictEqual(validateExpiresIn(0), 3600);
    });

    test("should return default for unreasonably large values", () => {
      const tooLarge = 365 * 24 * 60 * 60 + 1;
      assert.strictEqual(validateExpiresIn(tooLarge), 3600);
    });

    test("should return default for undefined", () => {
      assert.strictEqual(validateExpiresIn(undefined), 3600);
      assert.strictEqual(validateExpiresIn(undefined, 1800), 1800);
    });
  });

  describe("validateInterval", () => {
    test("should accept valid intervals", () => {
      assert.strictEqual(validateInterval(5), 5);
      assert.strictEqual(validateInterval(30), 30);
    });

    test("should clamp intervals outside range", () => {
      assert.strictEqual(validateInterval(0), 5); // default
      assert.strictEqual(validateInterval(-5), 5); // default for negative
      assert.strictEqual(validateInterval(61), 60); // clamp to max
      assert.strictEqual(validateInterval(100), 60); // clamp to max
    });

    test("should return default for undefined", () => {
      assert.strictEqual(validateInterval(undefined), 5);
      assert.strictEqual(validateInterval(undefined, 10), 10);
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

      assert.strictEqual(sanitized.access_token, "[REDACTED]");
      assert.strictEqual(sanitized.refresh_token, "[REDACTED]");
      assert.strictEqual(sanitized.user_code, "ABC123");
    });

    test("should handle nested objects", () => {
      const data = {
        auth: {
          api_key: "secret",
          username: "user",
        },
      };

      const sanitized = sanitizeLogData(data);

      assert.strictEqual(sanitized.auth.api_key, "[REDACTED]");
      assert.strictEqual(sanitized.auth.username, "user");
    });

    test("should handle non-objects", () => {
      assert.strictEqual(sanitizeLogData(null), null);
      assert.strictEqual(sanitizeLogData("string"), "string");
      assert.strictEqual(sanitizeLogData(123), 123);
    });
  });
});

