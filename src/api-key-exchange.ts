/**
 * API Key Exchange for Qwen
 * Attempts to exchange OAuth token for API key
 */

import { debugLog, warnLog, infoLog } from "./utils/logger.js";
import { QWEN_OAUTH_BASE_URL } from "./constants.js";

interface ApiKeyResponse {
  success: boolean;
  api_key?: string;
  error?: string;
}

/**
 * Potential endpoints for API key retrieval
 */
const API_KEY_ENDPOINTS = [
  "/api/v1/user/api-key",
  "/api/v1/user/token",
  "/api/v1/user/info",
  "/api/v1/auth/api-key",
  "/api/v1/oauth2/api-key",
];

/**
 * Try to get API key from OAuth token
 * This is speculative - Qwen may require OAuth token → API key exchange
 */
export async function tryGetApiKey(oauthToken: string): Promise<ApiKeyResponse> {
  debugLog("Attempting to exchange OAuth token for API key");
  
  for (const endpoint of API_KEY_ENDPOINTS) {
    const url = `${QWEN_OAUTH_BASE_URL}${endpoint}`;
    
    try {
      debugLog(`Trying endpoint: ${url}`);
      
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${oauthToken}`,
          "Content-Type": "application/json",
        },
      });
      
      debugLog(`Endpoint ${endpoint} responded with ${response.status}`);
      
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        
        // Look for API key in various possible fields
        const apiKey = data.api_key || data.apiKey || data.key || data.token;
        
        if (apiKey && typeof apiKey === "string") {
          infoLog(`Found API key via endpoint: ${endpoint}`);
          return {
            success: true,
            api_key: apiKey,
          };
        }
        
        debugLog(`Endpoint ${endpoint} returned data but no API key found`, {
          fields: Object.keys(data),
        });
      }
    } catch (error) {
      debugLog(`Error trying endpoint ${endpoint}:`, {
        error: String(error),
      });
    }
  }
  
  warnLog("Could not find API key exchange endpoint");
  return {
    success: false,
    error: "No API key exchange endpoint found",
  };
}

/**
 * Check if we need to use OAuth token directly or exchange for API key
 */
export async function validateTokenWithApi(token: string, apiBaseUrl: string): Promise<boolean> {
  try {
    debugLog("Validating token with API endpoint");
    
    // Try a simple API call to see if token works
    const response = await fetch(`${apiBaseUrl}/models`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });
    
    if (response.ok) {
      infoLog("Token is valid for API endpoint");
      return true;
    }
    
    debugLog("Token validation failed", {
      status: response.status,
      statusText: response.statusText,
    });
    
    return false;
  } catch (error) {
    debugLog("Error validating token", { error: String(error) });
    return false;
  }
}
