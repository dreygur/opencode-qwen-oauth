/**
 * Diagnostic utilities for testing Qwen OAuth endpoints
 */

import {
  QWEN_OAUTH_BASE_URL,
  QWEN_DEVICE_CODE_ENDPOINT,
  QWEN_TOKEN_ENDPOINT,
  QWEN_API_BASE_URL,
  QWEN_CLIENT_ID,
  QWEN_SCOPES,
} from "./constants.js";
import { createPkcePair } from "./pkce.js";

export interface DiagnosticResult {
  success: boolean;
  endpoint: string;
  status?: number;
  statusText?: string;
  error?: string;
  data?: any;
  responseTime?: number;
}

/**
 * Test if Qwen OAuth device code endpoint is accessible
 */
export async function testDeviceCodeEndpoint(): Promise<DiagnosticResult> {
  const startTime = Date.now();
  const endpoint = `${QWEN_OAUTH_BASE_URL}${QWEN_DEVICE_CODE_ENDPOINT}`;
  
  try {
    const { verifier, challenge } = createPkcePair();
    const params = new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      scope: QWEN_SCOPES.join(" "),
      code_challenge: challenge,
      code_challenge_method: "S256",
    });

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json().catch(() => null);

    return {
      success: response.ok,
      endpoint,
      status: response.status,
      statusText: response.statusText,
      data,
      responseTime,
      error: response.ok ? undefined : (data && typeof data === 'object' && 'error' in data ? String(data.error) : response.statusText),
    };
  } catch (error) {
    return {
      success: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Test if Qwen API endpoint is accessible
 * Tests the /chat/completions endpoint (OpenAI-compatible)
 */
export async function testAPIEndpoint(baseURL: string, token?: string): Promise<DiagnosticResult> {
  const startTime = Date.now();
  const endpoint = `${baseURL}/chat/completions`;
  
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Make a test request to the chat completions endpoint
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "qwen3-coder-plus",
        messages: [{ role: "user", content: "test" }],
        max_tokens: 1,
      }),
    });

    const responseTime = Date.now() - startTime;
    const data = await response.json().catch(() => null);

    // For API endpoints, we consider:
    // - 200 = success (with valid token)
    // - 401 = endpoint exists but needs auth (without token)
    // - Other statuses = endpoint might not exist or has issues
    const endpointExists = response.status === 200 || response.status === 401;

    return {
      success: response.ok,
      endpoint,
      status: response.status,
      statusText: response.statusText,
      data,
      responseTime,
      error: response.ok ? undefined : (data && typeof data === 'object' && 'error' in data ? 
        JSON.stringify(data.error) : response.statusText),
    };
  } catch (error) {
    return {
      success: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Test if the base OAuth URL is accessible
 */
export async function testBaseURL(): Promise<DiagnosticResult> {
  const startTime = Date.now();
  const endpoint = QWEN_OAUTH_BASE_URL;
  
  try {
    const response = await fetch(endpoint, {
      method: "GET",
      redirect: "manual",
    });

    const responseTime = Date.now() - startTime;

    return {
      success: response.status < 400,
      endpoint,
      status: response.status,
      statusText: response.statusText,
      responseTime,
    };
  } catch (error) {
    return {
      success: false,
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Run all diagnostic tests
 */
export async function runDiagnostics(token?: string): Promise<{
  baseURL: DiagnosticResult;
  deviceCode: DiagnosticResult;
  apis: Record<string, DiagnosticResult>;
}> {
  console.log("Running Qwen OAuth diagnostics...\n");

  const baseURL = await testBaseURL();
  console.log(`[Base URL] ${baseURL.endpoint}`);
  console.log(`  Status: ${baseURL.success ? "✓" : "✗"} ${baseURL.status || "N/A"}`);
  console.log(`  Time: ${baseURL.responseTime}ms`);
  if (baseURL.error) console.log(`  Error: ${baseURL.error}`);
  console.log();

  const deviceCode = await testDeviceCodeEndpoint();
  console.log(`[Device Code] ${deviceCode.endpoint}`);
  console.log(`  Status: ${deviceCode.success ? "✓" : "✗"} ${deviceCode.status || "N/A"}`);
  console.log(`  Time: ${deviceCode.responseTime}ms`);
  if (deviceCode.error) console.log(`  Error: ${deviceCode.error}`);
  if (deviceCode.data) {
    console.log(`  Response: ${JSON.stringify(deviceCode.data, null, 2)}`);
  }
  console.log();

  // Test multiple potential API base URLs
  const apiEndpoints = [
    QWEN_API_BASE_URL, // Current: https://portal.qwen.ai/v1
    "https://chat.qwen.ai/api/v1",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ];

  const apis: Record<string, DiagnosticResult> = {};
  
  console.log("[API Endpoints] Testing /chat/completions on multiple base URLs...\n");
  for (const apiURL of apiEndpoints) {
    const result = await testAPIEndpoint(apiURL, token);
    apis[apiURL] = result;
    
    const statusIcon = result.success ? "✓" : 
                      (result.status === 401 ? "⚠" : "✗");
    
    console.log(`  ${statusIcon} ${apiURL}`);
    console.log(`    Status: ${result.status || "N/A"} (${result.responseTime}ms)`);
    if (result.status === 401) {
      console.log(`    Note: Endpoint exists but requires authentication`);
    }
    if (result.error) console.log(`    Error: ${result.error}`);
  }
  console.log();

  return { baseURL, deviceCode, apis };
}

// CLI interface for running diagnostics
if (import.meta.url === `file://${process.argv[1]}`) {
  const token = process.argv[2];
  runDiagnostics(token).then((results) => {
    const allSuccess = results.baseURL.success && results.deviceCode.success;
    const anyAPIWorks = Object.values(results.apis).some(api => api.success);
    const anyAPIExists = Object.values(results.apis).some(api => api.status === 401 || api.success);
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`OAuth Status: ${allSuccess ? "✓ PASS" : "✗ FAIL"}`);
    
    if (token) {
      console.log(`API Status: ${anyAPIWorks ? "✓ Working with token" : "✗ Failed with token"}`);
    } else {
      console.log(`API Status: ${anyAPIExists ? "⚠ Endpoints exist (need token)" : "✗ No endpoints found"}`);
    }
    
    if (anyAPIWorks) {
      const workingEndpoint = Object.entries(results.apis).find(([_, result]) => result.success);
      if (workingEndpoint) {
        console.log(`\n💡 Recommended API base URL: ${workingEndpoint[0]}`);
      }
    } else if (anyAPIExists && !token) {
      const existingEndpoint = Object.entries(results.apis).find(([_, result]) => result.status === 401);
      if (existingEndpoint) {
        console.log(`\n💡 Recommended API base URL: ${existingEndpoint[0]}`);
        console.log(`ℹ️  Run diagnostics with a token to test authenticated requests`);
      }
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    process.exit(allSuccess ? 0 : 1);
  });
}
