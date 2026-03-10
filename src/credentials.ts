/**
 * Credential storage for Qwen OAuth
 * Saves/loads credentials from ~/.qwen/oauth_creds.json
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface QwenCredentials {
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  tokenType?: string;
  resourceUrl?: string;
  scope?: string;
}

// Internal format with snake_case (matches OAuth response)
interface QwenCredentialsFile {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  resource_url?: string;
  scope?: string;
}

const CREDENTIALS_DIR = join(homedir(), ".qwen");
const CREDENTIALS_FILE = join(CREDENTIALS_DIR, "oauth_creds.json");

function ensureCredentialsDir(): void {
  if (!existsSync(CREDENTIALS_DIR)) {
    mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
  }
}

export function saveCredentials(credentials: QwenCredentials): void {
  try {
    ensureCredentialsDir();
    // Save in snake_case format (matches OAuth response)
    const data: QwenCredentialsFile = {
      access_token: credentials.accessToken,
      refresh_token: credentials.refreshToken,
      expiry_date: credentials.expiryDate,
      token_type: credentials.tokenType,
      resource_url: credentials.resourceUrl,
      scope: credentials.scope,
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(data, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
  } catch (error) {
    console.error("Failed to save credentials:", error);
  }
}

export function loadCredentials(): QwenCredentials | null {
  try {
    if (!existsSync(CREDENTIALS_FILE)) {
      return null;
    }
    const data = readFileSync(CREDENTIALS_FILE, "utf-8");
    const fileCreds = JSON.parse(data) as QwenCredentialsFile;
    
    // Convert snake_case to camelCase
    const credentials: QwenCredentials = {
      accessToken: fileCreds.access_token,
      refreshToken: fileCreds.refresh_token,
      expiryDate: fileCreds.expiry_date,
      tokenType: fileCreds.token_type,
      resourceUrl: fileCreds.resource_url,
      scope: fileCreds.scope,
    };
    
    // Check if token is expired
    if (credentials.expiryDate && Date.now() > credentials.expiryDate) {
      return null;
    }
    
    return credentials;
  } catch {
    return null;
  }
}

export function deleteCredentials(): void {
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      writeFileSync(CREDENTIALS_FILE, JSON.stringify({}, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      });
    }
  } catch {
    // Ignore errors
  }
}
