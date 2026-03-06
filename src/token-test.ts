#!/usr/bin/env node
/**
 * Token Diagnostic Test
 * Helps identify token-related issues
 */

import { validateToken } from "./validation.js";
import { debugLog, errorLog, infoLog } from "./logger.js";

interface TestCase {
  name: string;
  token: string;
  shouldPass: boolean;
}

const testCases: TestCase[] = [
  // Valid tokens
  { name: "Standard JWT-like token", token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c", shouldPass: true },
  { name: "Short alphanumeric token", token: "abcd1234567890", shouldPass: true },
  { name: "10 character token (minimum)", token: "a1b2c3d4e5", shouldPass: true },
  { name: "Token with special chars", token: "abc-def_ghi.jkl", shouldPass: true },
  
  // Invalid tokens
  { name: "Empty string", token: "", shouldPass: false },
  { name: "Too short (9 chars)", token: "abc123456", shouldPass: false },
  { name: "Token with spaces", token: "abc def 123", shouldPass: false },
  { name: "Token with invalid chars", token: "abc@def#123", shouldPass: false },
];

console.log("🔍 Token Validation Diagnostic Test\n");

let passed = 0;
let failed = 0;

for (const test of testCases) {
  try {
    validateToken(test.token);
    if (test.shouldPass) {
      console.log(`✅ PASS: ${test.name}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${test.name} - Expected to fail but passed`);
      failed++;
    }
  } catch (error) {
    if (!test.shouldPass) {
      console.log(`✅ PASS: ${test.name} - Failed as expected`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${test.name}`);
      console.log(`   Error: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

// Test token expiry calculation
console.log("🕐 Testing Token Expiry Calculation:\n");

const testExpiryScenarios = [
  { expiresIn: 21600, name: "6 hours (Qwen default)" },
  { expiresIn: 3600, name: "1 hour" },
  { expiresIn: 0, name: "Zero (should use default)" },
  { expiresIn: undefined, name: "Undefined (should use default)" },
];

for (const scenario of testExpiryScenarios) {
  const expiresIn = scenario.expiresIn || 0;
  const expires = expiresIn > 0 
    ? Date.now() + expiresIn * 1000 
    : Date.now() + 3600 * 1000;
  
  const expiresDate = new Date(expires);
  const minutesUntilExpiry = Math.round((expires - Date.now()) / 1000 / 60);
  
  console.log(`  ${scenario.name}:`);
  console.log(`    Expires at: ${expiresDate.toISOString()}`);
  console.log(`    Minutes until expiry: ${minutesUntilExpiry}`);
  console.log();
}

console.log("✨ Diagnostic test complete!\n");

process.exit(failed > 0 ? 1 : 0);
