/**
 * Credential storage repository
 * Handles file system operations for OAuth credentials
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { StoredCredentials } from "../types.js";
import { debugLog, warnLog } from "../utils/logger.js";

const CREDENTIALS_PATH = join(homedir(), ".qwen", "oauth_creds.json");

export class CredentialRepository {
  private ensureDirectory(): void {
    const dir = join(homedir(), ".qwen");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  save(credentials: StoredCredentials): boolean {
    try {
      this.ensureDirectory();
      writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
      debugLog("Credentials saved", { path: CREDENTIALS_PATH });
      return true;
    } catch (error) {
      warnLog("Failed to save credentials", { error: String(error) });
      return false;
    }
  }

  load(): StoredCredentials | null {
    try {
      if (!existsSync(CREDENTIALS_PATH)) {
        return null;
      }

      const data = readFileSync(CREDENTIALS_PATH, "utf-8");
      const credentials = JSON.parse(data) as StoredCredentials;

      if (!credentials.accessToken || !credentials.refreshToken) {
        return null;
      }

      debugLog("Credentials loaded", {
        hasAccess: !!credentials.accessToken,
        hasRefresh: !!credentials.refreshToken,
        expiryDate: credentials.expiryDate,
      });

      return credentials;
    } catch (error) {
      debugLog("Failed to load credentials", { error: String(error) });
      return null;
    }
  }

  clear(): boolean {
    try {
      if (existsSync(CREDENTIALS_PATH)) {
        writeFileSync(CREDENTIALS_PATH, JSON.stringify({}));
      }
      return true;
    } catch (error) {
      warnLog("Failed to clear credentials", { error: String(error) });
      return false;
    }
  }
}

export const credentialRepository = new CredentialRepository();
