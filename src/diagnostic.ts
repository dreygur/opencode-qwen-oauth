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
import { openBrowser } from "./browser.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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

  // Test only the API endpoint that supports OAuth tokens
  // OAuth tokens from chat.qwen.ai only work with portal.qwen.ai
  const apiEndpoints = [
    QWEN_API_BASE_URL, // https://portal.qwen.ai/v1 - the only one that works with OAuth
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
    if (token && result.status === 401) {
      console.log(`    Note: Token provided but endpoint rejected it`);
    } else if (!token && result.status === 401) {
      console.log(`    Note: Endpoint exists but requires authentication`);
    }
    if (result.error) console.log(`    Error: ${result.error}`);
  }
  console.log();

  return { baseURL, deviceCode, apis };
}

/**
 * Run the OAuth device flow to get a token
 */
export async function runOAuthFlow(): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> {
  console.log("\n🔐 Starting OAuth Device Flow...\n");

  const { verifier, challenge } = createPkcePair();

  // Step 1: Request device code
  console.log("1️⃣  Requesting device code...");
  const deviceParams = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPES.join(" "),
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  const deviceResponse = await fetch(
    `${QWEN_OAUTH_BASE_URL}${QWEN_DEVICE_CODE_ENDPOINT}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: deviceParams.toString(),
    }
  );

  if (!deviceResponse.ok) {
    const error = await deviceResponse.json().catch(() => ({}));
    console.log(`❌ Failed to get device code: ${JSON.stringify(error)}`);
    return null;
  }

  const deviceData = await deviceResponse.json() as {
    device_code: string;
    user_code: string;
    verification_uri_complete: string;
    verification_uri: string;
    expires_in: number;
    interval?: number;
  };

  const {
    device_code,
    user_code,
    verification_uri_complete,
    verification_uri,
    expires_in,
    interval = 5,
  } = deviceData;

  console.log(`   ✓ Device code received`);
  console.log(`   📋 User code: ${user_code}`);
  console.log(`   ⏰ Expires in: ${expires_in} seconds\n`);

  // Step 2: Open browser and prompt user
  console.log("2️⃣  Opening browser for authorization...");
  openBrowser(verification_uri_complete || verification_uri);
  console.log(`   ✓ Browser opened\n`);

  // Step 3: Poll for token
  console.log("3️⃣  Polling for authorization...");
  console.log(`   📌 Enter code: ${user_code}`);
  console.log(`   ⏳ Waiting for authorization...\n`);

  const startTime = Date.now();
  const timeout = expires_in * 1000;
  const pollingInterval = interval * 1000;

  while (Date.now() - startTime < timeout) {
    await new Promise((resolve) => setTimeout(resolve, pollingInterval));

    const tokenParams = new URLSearchParams({
      client_id: QWEN_CLIENT_ID,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code,
      code_verifier: verifier,
    });

    const tokenResponse = await fetch(
      `${QWEN_OAUTH_BASE_URL}${QWEN_TOKEN_ENDPOINT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenParams.toString(),
      }
    );

    const tokenData = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (tokenResponse.ok) {
      console.log(`   ✓ Authorization successful!\n`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🎉 OAuth Flow Complete!`);
      console.log(`   Access token: ${tokenData.access_token?.substring(0, 20)}...`);
      console.log(`   Refresh token: ${tokenData.refresh_token?.substring(0, 20)}...`);
      console.log(`   Expires in: ${tokenData.expires_in} seconds`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      return {
        access_token: tokenData.access_token!,
        refresh_token: tokenData.refresh_token!,
        expires_in: tokenData.expires_in!,
      };
    }

    if (tokenData.error === "authorization_pending") {
      process.stdout.write("   ⏳ Still waiting...\n");
      continue;
    }

    if (tokenData.error === "slow_down") {
      console.log(`   ⚠️ Rate limited, slowing down...`);
      await new Promise((resolve) => setTimeout(resolve, pollingInterval));
      continue;
    }

    console.log(`   ❌ Error: ${tokenData.error_description || tokenData.error}`);
    return null;
  }

  console.log(`   ❌ Authorization timed out`);
  return null;
}

/**
 * Refresh an access token
 */
export async function refreshToken(
  refreshToken: string
): Promise<{ access_token: string; expires_in: number } | null> {
  const params = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const response = await fetch(
    `${QWEN_OAUTH_BASE_URL}${QWEN_TOKEN_ENDPOINT}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    console.log(`❌ Token refresh failed: ${JSON.stringify(error)}`);
    return null;
  }

  const data = await response.json() as {
    access_token: string;
    expires_in: number;
  };
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

/**
 * Save token to file for later use
 */
function saveTokenToFile(token: string, refreshToken: string, expiresIn: number): string {
  const configDir = join(homedir(), ".config", "opencode");
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }
  
  const tokenData = {
    access_token: token,
    refresh_token: refreshToken,
    expires_in: expiresIn,
    expires_at: Date.now() + expiresIn * 1000,
    saved_at: new Date().toISOString(),
  };
  
  const tokenPath = join(configDir, "qwen-test-token.json");
  writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
  return tokenPath;
}

// CLI interface for running diagnostics
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const token = args[0];
  const runOAuth = args.includes("--oauth") || args.includes("-o");
  const loadToken = args.includes("--load") || args.includes("-l");
  const doRefresh = args.includes("--refresh") || args.includes("-r");

  async function main() {
    let accessToken = token;

    // Show usage if no args and no token
    if (!token && !runOAuth && !loadToken && !doRefresh) {
      console.log("\n📋 Usage:");
      console.log("   node dist/diagnostic.js                    # Run basic diagnostics");
      console.log("   node dist/diagnostic.js <token>           # Run diagnostics with token");
      console.log("   node dist/diagnostic.js --oauth           # Run OAuth flow + diagnostics");
      console.log("   node dist/diagnostic.js --load            # Load saved token and test");
      console.log("   node dist/diagnostic.js --refresh         # Refresh saved token and test\n");
    }

    // Load token from file if --load flag
    if (loadToken) {
      const configDir = join(homedir(), ".config", "opencode");
      const tokenPath = join(configDir, "qwen-test-token.json");
      try {
        if (existsSync(tokenPath)) {
          const tokenData = JSON.parse(readFileSync(tokenPath, "utf-8"));
          if (tokenData.expires_at > Date.now()) {
            accessToken = tokenData.access_token;
            console.log(`📂 Loaded token from: ${tokenPath}`);
          } else {
            console.log(`⏰ Token expired at: ${new Date(tokenData.expires_at).toISOString()}`);
            console.log(`   Run --oauth to get a new token`);
            return; // Exit early
          }
        } else {
          console.log(`📂 No saved token found at: ${tokenPath}`);
          console.log(`   Run --oauth to authenticate`);
          return; // Exit early
        }
      } catch (e) {
        console.log(`❌ Failed to load token: ${e}`);
        return; // Exit early
      }
    }

    // Refresh token if --refresh flag
    if (doRefresh) {
      const configDir = join(homedir(), ".config", "opencode");
      const tokenPath = join(configDir, "qwen-test-token.json");
      try {
        if (existsSync(tokenPath)) {
          const tokenData = JSON.parse(readFileSync(tokenPath, "utf-8"));
          console.log(`🔄 Refreshing token...`);
          const refreshed = await refreshToken(tokenData.refresh_token);
          if (refreshed) {
            accessToken = refreshed.access_token;
            const newTokenData = {
              access_token: accessToken,
              refresh_token: tokenData.refresh_token,
              expires_in: refreshed.expires_in,
              expires_at: Date.now() + refreshed.expires_in * 1000,
              saved_at: new Date().toISOString(),
            };
            writeFileSync(tokenPath, JSON.stringify(newTokenData, null, 2));
            console.log(`💾 Token refreshed and saved to: ${tokenPath}`);
          }
        }
      } catch (e) {
        console.log(`❌ Failed to refresh token: ${e}`);
        return; // Exit early
      }
    }

    // Run OAuth flow if --oauth flag
    if (runOAuth) {
      const oauthResult = await runOAuthFlow();
      if (oauthResult) {
        accessToken = oauthResult.access_token;
        
        // Save token to file
        const tokenPath = saveTokenToFile(
          oauthResult.access_token,
          oauthResult.refresh_token,
          oauthResult.expires_in
        );
        console.log(`💾 Token saved to: ${tokenPath}`);
      } else {
        console.log("❌ OAuth flow failed or was cancelled");
        process.exit(1);
      }
    }

    const results = await runDiagnostics(accessToken);
    const allSuccess = results.baseURL.success && results.deviceCode.success;
    const anyAPIWorks = Object.values(results.apis).some(api => api.success);
    const anyAPIExists = Object.values(results.apis).some(api => api.status === 401 || api.success);
    
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`OAuth Status: ${allSuccess ? "✓ PASS" : "✗ FAIL"}`);
    
    if (accessToken) {
      console.log(`API Status: ${anyAPIWorks ? "✓ Working with token" : "✗ Failed with token"}`);
      
      // Show which endpoints work with the token
      const workingEndpoints = Object.entries(results.apis)
        .filter(([_, result]) => result.success)
        .map(([url]) => url);
      const failedEndpoints = Object.entries(results.apis)
        .filter(([_, result]) => !result.success)
        .map(([url]) => url);
      
      if (workingEndpoints.length > 0) {
        console.log(`\n✅ Endpoints working with OAuth token:`);
        workingEndpoints.forEach(url => console.log(`   - ${url}`));
      }
      if (failedEndpoints.length > 0) {
        console.log(`\n⚠️  Endpoints NOT supporting OAuth token:`);
        failedEndpoints.forEach(url => console.log(`   - ${url}`));
      }
    } else {
      console.log(`API Status: ${anyAPIExists ? "⚠ Endpoints exist (need token)" : "✗ No endpoints found"}`);
    }
    
    if (anyAPIWorks) {
      const workingEndpoint = Object.entries(results.apis).find(([_, result]) => result.success);
      if (workingEndpoint) {
        console.log(`\n💡 Recommended API base URL: ${workingEndpoint[0]}`);
      }
    } else if (anyAPIExists && !accessToken) {
      const existingEndpoint = Object.entries(results.apis).find(([_, result]) => result.status === 401);
      if (existingEndpoint) {
        console.log(`\n💡 Recommended API base URL: ${existingEndpoint[0]}`);
        console.log(`ℹ️  Run with --oauth flag to test with authentication`);
      }
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    
    process.exit(allSuccess ? 0 : 1);
  }

  main();
}
