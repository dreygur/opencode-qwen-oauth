/**
 * Logging utilities for Qwen OAuth Plugin
 */

import { appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function getLogDir(): string {
  const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdgConfig, "opencode", "logs");
}

function getLogFilePath(): string {
  return join(getLogDir(), "qwen-oauth.log");
}

function ensureLogDir(): void {
  const logDir = getLogDir();
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true, mode: 0o700 });
  }
}

function writeLog(message: string): void {
  try {
    ensureLogDir();
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;
    appendFileSync(getLogFilePath(), logLine, { encoding: "utf-8" });
  } catch {
    // Silently ignore log write errors
  }
}

export const DEBUG =
  process.env.QWEN_OAUTH_DEBUG === "true" ||
  process.env.QWEN_OAUTH_DEBUG === "1";

export function debugLog(message: string, data?: Record<string, unknown>): void {
  const logMessage = data ? `${message} ${JSON.stringify(data)}` : message;
  writeLog(logMessage);
}
